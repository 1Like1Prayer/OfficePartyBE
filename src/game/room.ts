/**
 * A room: the players in it, who owns it, and the competition running inside
 * it (sections 5 and 6).
 *
 * The room emits through a RoomEmitter rather than touching Socket.IO, so
 * nothing in here depends on the transport.
 */

import { COMPETITION, ROOM } from '../shared/constants';
import { GAME_CATALOG, GAME_IDS, type GameId } from '../shared/games/catalog';
import type {
    ErrorCode,
    GameStartingPayload,
    JoinAckData,
    PlayerView,
    PlaylistMode,
    RoomPhase,
    RoomStatePayload,
    RoundView
} from '../shared/protocol';
import { ServerEvent } from '../shared/protocol';
import { buildCustomPlaylist, buildRandomPlaylist, Competition } from './competition';
import { monotonicNowMs } from './clock';
import { newPlayerId, sanitizeName } from './ids';
import { getSelfTimedModule } from './registry';
import { SelfTimedRound, type AttemptResolved } from './selfTimedRound';

export interface RoomEmitter {
    toRoom(event: string, payload: unknown): void;
    toSocket(socketId: string, event: string, payload: unknown): void;
}

export type RoomResult<T> =
    | { ok: true; data: T }
    | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode, message: string): RoomResult<never> => ({
    ok: false,
    code,
    message
});

interface Player {
    playerId: string;
    name: string;
    socketId: string | null;
    connected: boolean;
    /** Monotonic time of first join. Decides owner succession. */
    joinedAt: number;
    disconnectedAt: number | null;
    /** Joined after the competition started; watches until the next lobby. */
    isSpectator: boolean;
    dropTimer: NodeJS.Timeout | null;
}

export interface RoomOptions {
    roomCode: string;
    emitter: RoomEmitter;
    onEmpty?: (roomCode: string) => void;
}

export class Room {
    readonly roomCode: string;

    private readonly emitter: RoomEmitter;
    private readonly onEmpty: ((roomCode: string) => void) | undefined;

    private readonly players = new Map<string, Player>();
    private ownerId: string | null = null;
    private phase: RoomPhase = 'lobby';

    private mode: PlaylistMode = 'random';
    private customPlaylist: GameId[] = [];

    private competition: Competition | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private round: SelfTimedRound<any, any> | null = null;
    private lastRoundView: RoundView | null = null;

    private phaseTimer: NodeJS.Timeout | null = null;
    private destroyed = false;
    /** Monotonic time the last connected player left, for the manager's sweep. */
    private emptySinceMs: number | null = null;

    constructor(options: RoomOptions) {
        this.roomCode = options.roomCode;
        this.emitter = options.emitter;
        this.onEmpty = options.onEmpty;
        this.emptySinceMs = monotonicNowMs();
    }

    /* ================================================================ */
    /* Membership                                                        */
    /* ================================================================ */

    /**
     * Join, or reclaim a held slot. A returning playerId always wins over the
     * capacity check — the slot was already theirs.
     */
    join(params: {
        socketId: string;
        name: unknown;
        playerId?: string | undefined;
    }): RoomResult<JoinAckData> {
        if (this.destroyed) return fail('room_not_found', 'That room is gone.');

        const existing = params.playerId
            ? this.players.get(params.playerId)
            : undefined;

        if (existing) {
            this.clearDropTimer(existing);
            const wasDisconnected = !existing.connected;
            existing.socketId = params.socketId;
            existing.connected = true;
            existing.disconnectedAt = null;
            existing.name = sanitizeName(params.name, existing.name);
            this.emptySinceMs = null;
            if (this.ownerId === null) this.ownerId = existing.playerId;

            if (wasDisconnected) {
                this.emitter.toRoom(ServerEvent.PlayerReconnected, {
                    playerId: existing.playerId,
                    name: existing.name
                });
            }
            this.broadcastState();
            this.sendRoundSnapshot(existing);
            return {
                ok: true,
                data: {
                    playerId: existing.playerId,
                    roomCode: this.roomCode,
                    state: this.getState(),
                    reconnected: true
                }
            };
        }

        if (this.players.size >= ROOM.MAX_PLAYERS) {
            return fail('room_full', `That room is full (${ROOM.MAX_PLAYERS} players).`);
        }

        const playerId = newPlayerId();
        const player: Player = {
            playerId,
            name: sanitizeName(params.name, `Player ${this.players.size + 1}`),
            socketId: params.socketId,
            connected: true,
            joinedAt: monotonicNowMs(),
            disconnectedAt: null,
            // Joining late is free in the lobby; once a competition is running
            // the newcomer watches until it returns to the lobby.
            isSpectator: this.phase !== 'lobby',
            dropTimer: null
        };
        this.players.set(playerId, player);
        this.competition?.ensurePlayer(playerId);
        this.emptySinceMs = null;
        if (this.ownerId === null) this.ownerId = playerId;

        this.emitter.toRoom(ServerEvent.PlayerJoined, {
            playerId,
            name: player.name,
            isSpectator: player.isSpectator
        });
        this.broadcastState();
        this.sendRoundSnapshot(player);

        return {
            ok: true,
            data: {
                playerId,
                roomCode: this.roomCode,
                state: this.getState(),
                reconnected: false
            }
        };
    }

    /**
     * The socket dropped. Hold the slot ~30 s; the current round stops waiting
     * on them straight away so nobody else is held up.
     */
    handleDisconnect(playerId: string, socketId?: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        // A reconnect that already claimed this slot supersedes the old socket.
        if (socketId && player.socketId !== socketId) return;

        player.connected = false;
        player.socketId = null;
        player.disconnectedAt = monotonicNowMs();

        this.round?.dropParticipant(playerId);
        this.emitter.toRoom(ServerEvent.PlayerLeft, {
            playerId,
            name: player.name,
            permanent: false
        });

        if (this.ownerId === playerId) this.transferOwnership();

        this.clearDropTimer(player);
        player.dropTimer = setTimeout(
            () => this.removePlayer(playerId),
            ROOM.DISCONNECT_GRACE_MS
        );

        this.checkEmpty();
        this.broadcastState();
    }

    /** An explicit "leave the room" — no grace period. */
    leave(playerId: string): void {
        this.round?.dropParticipant(playerId);
        this.removePlayer(playerId);
    }

    private removePlayer(playerId: string): void {
        const player = this.players.get(playerId);
        if (!player) return;
        this.clearDropTimer(player);
        this.players.delete(playerId);
        this.round?.dropParticipant(playerId);

        this.emitter.toRoom(ServerEvent.PlayerLeft, {
            playerId,
            name: player.name,
            permanent: true
        });

        if (this.ownerId === playerId) this.transferOwnership();
        this.checkEmpty();
        this.broadcastState();
    }

    /** Ownership goes to whoever has been connected longest. */
    private transferOwnership(): void {
        const candidates = [...this.players.values()]
            .filter((p) => p.connected)
            .sort((a, b) => a.joinedAt - b.joinedAt);

        const next = candidates[0] ?? null;
        this.ownerId = next?.playerId ?? null;
        if (next) {
            this.emitter.toRoom(ServerEvent.OwnerChanged, {
                ownerId: next.playerId,
                name: next.name
            });
        }
    }

    private checkEmpty(): void {
        const anyConnected = [...this.players.values()].some((p) => p.connected);
        if (anyConnected) {
            this.emptySinceMs = null;
            return;
        }
        if (this.emptySinceMs === null) this.emptySinceMs = monotonicNowMs();
        this.onEmpty?.(this.roomCode);
    }

    /** Used by the manager's sweep to reap abandoned rooms. */
    isExpired(nowMs: number): boolean {
        return (
            this.emptySinceMs !== null &&
            nowMs - this.emptySinceMs > ROOM.EMPTY_TTL_MS
        );
    }

    setName(playerId: string, name: unknown): RoomResult<{ name: string }> {
        const player = this.players.get(playerId);
        if (!player) return fail('not_in_room', 'You are not in this room.');
        player.name = sanitizeName(name, player.name);
        this.broadcastState();
        return { ok: true, data: { name: player.name } };
    }

    /* ================================================================ */
    /* Lobby                                                             */
    /* ================================================================ */

    setMode(
        playerId: string,
        mode: PlaylistMode,
        gameIds: GameId[] | undefined
    ): RoomResult<{ mode: PlaylistMode; playlist: GameId[] }> {
        const guard = this.requireOwnerInLobby(playerId);
        if (guard) return guard;

        if (mode === 'custom') {
            const built = buildCustomPlaylist(gameIds ?? []);
            if (!Array.isArray(built)) return fail(built.code, built.message);
            this.customPlaylist = built;
        } else {
            this.customPlaylist = [];
        }
        this.mode = mode;
        this.broadcastState();
        return { ok: true, data: { mode: this.mode, playlist: this.customPlaylist } };
    }

    startCompetition(playerId: string): RoomResult<{ playlist: GameId[] }> {
        const guard = this.requireOwnerInLobby(playerId);
        if (guard) return guard;

        const active = this.activePlayers();
        if (active.length < ROOM.MIN_PLAYERS) {
            return fail(
                'not_enough_players',
                `Need at least ${ROOM.MIN_PLAYERS} connected players.`
            );
        }

        const playlist =
            this.mode === 'custom' ? this.customPlaylist : buildRandomPlaylist();
        if (playlist.length === 0) {
            return fail('invalid_playlist', 'No playable games are available.');
        }

        this.competition = new Competition(
            this.mode,
            playlist,
            active.map((p) => p.playerId)
        );
        this.phase = 'competition';
        this.emitter.toRoom(
            ServerEvent.Playlist,
            this.competition.describePlaylist()
        );
        this.broadcastState();
        this.startNextRound();

        return { ok: true, data: { playlist: [...playlist] } };
    }

    private requireOwnerInLobby(playerId: string): RoomResult<never> | null {
        if (!this.players.has(playerId)) {
            return fail('not_in_room', 'You are not in this room.');
        }
        if (this.ownerId !== playerId) {
            return fail('not_owner', 'Only the room owner can do that.');
        }
        if (this.phase !== 'lobby') {
            return fail('competition_in_progress', 'A competition is already running.');
        }
        return null;
    }

    /* ================================================================ */
    /* Rounds                                                            */
    /* ================================================================ */

    private startNextRound(): void {
        if (this.destroyed || this.competition === null) return;

        const position = this.competition.position();
        if (position === null) {
            this.finishCompetition();
            return;
        }

        const module = getSelfTimedModule(position.gameId);
        if (module === null) {
            // Shouldn't happen — playlists only contain playable games — but
            // skip rather than wedge the match.
            if (this.competition.advance()) this.startNextRound();
            else this.finishCompetition();
            return;
        }

        const participants = this.activePlayers().map((p) => p.playerId);
        if (participants.length === 0) {
            this.abortToLobby();
            return;
        }

        const roundId = this.competition.nextRoundId();
        const starting: GameStartingPayload = {
            roundId,
            attempt: 0,
            gameId: position.gameId,
            title: GAME_CATALOG[position.gameId].title,
            gameIndex: position.gameIndex,
            totalGames: position.totalGames,
            roundInGame: position.roundInGame
        };
        this.emitter.toRoom(ServerEvent.GameStarting, starting);

        this.round = new SelfTimedRound({
            module,
            gameId: position.gameId,
            roundId,
            gameIndex: position.gameIndex,
            totalGames: position.totalGames,
            roundInGame: position.roundInGame,
            events: {
                onRoundData: (payload) =>
                    this.emitter.toRoom(ServerEvent.RoundData, payload),
                onReadyState: (payload) =>
                    this.emitter.toRoom(ServerEvent.ReadyState, payload),
                onStartAt: (payload) =>
                    this.emitter.toRoom(ServerEvent.StartAt, payload),
                onProgress: (payload) =>
                    this.emitter.toRoom(ServerEvent.RoundProgress, payload),
                onAttemptResolved: (payload) => this.onAttemptResolved(payload)
            }
        });
        this.round.begin(participants);
        this.broadcastState();
    }

    private onAttemptResolved(payload: AttemptResolved): void {
        if (this.competition === null) return;

        if (payload.isFinal) this.competition.award(payload.winnerId);

        const nextRoundAtServerMs = payload.isFinal
            ? monotonicNowMs() + COMPETITION.RESULT_DISPLAY_MS
            : null;

        this.emitter.toRoom(ServerEvent.RoundResults, {
            roundId: payload.roundId,
            attempt: payload.attempt,
            gameId: this.round?.gameId ?? null,
            ranked: payload.ranked,
            noShow: payload.noShow,
            winnerId: payload.winnerId,
            decidedByCoinFlip: payload.decidedByCoinFlip,
            isFinal: payload.isFinal,
            scores: this.competition.scoreRows(),
            nextRoundAtServerMs
        });

        if (!payload.isFinal) return;

        this.emitter.toRoom(ServerEvent.Scores, {
            scores: this.competition.scoreRows()
        });

        const described = this.round?.describe();
        this.lastRoundView = described
            ? { ...described, roundsPerGame: COMPETITION.ROUNDS_PER_GAME }
            : null;
        this.setPhaseTimer(
            () => this.advanceRound(),
            COMPETITION.RESULT_DISPLAY_MS
        );
    }

    /** Owner's "skip the results screen" button. */
    skipResults(playerId: string): RoomResult<null> {
        if (this.ownerId !== playerId) {
            return fail('not_owner', 'Only the room owner can skip.');
        }
        if (this.phase === 'leaderboard') {
            this.clearPhaseTimer();
            this.returnToLobby();
            return { ok: true, data: null };
        }
        if (this.phase !== 'competition' || this.phaseTimer === null) {
            return fail('wrong_phase', 'Nothing to skip right now.');
        }
        this.clearPhaseTimer();
        this.advanceRound();
        return { ok: true, data: null };
    }

    private advanceRound(): void {
        if (this.competition === null) return;
        this.round?.cancel();
        this.round = null;
        if (this.competition.advance()) this.startNextRound();
        else this.finishCompetition();
    }

    private finishCompetition(): void {
        if (this.competition === null) return;
        this.round?.cancel();
        this.round = null;
        this.phase = 'leaderboard';
        this.emitter.toRoom(ServerEvent.Leaderboard, this.competition.leaderboard());
        this.broadcastState();
        this.setPhaseTimer(
            () => this.returnToLobby(),
            COMPETITION.LEADERBOARD_DISPLAY_MS
        );
    }

    /** Everyone left mid-match. Tear the competition down rather than stall. */
    private abortToLobby(): void {
        this.round?.cancel();
        this.round = null;
        this.competition = null;
        this.phase = 'lobby';
        this.clearPhaseTimer();
        this.broadcastState();
    }

    private returnToLobby(): void {
        this.round?.cancel();
        this.round = null;
        this.competition = null;
        this.lastRoundView = null;
        this.phase = 'lobby';
        // Spectators from the finished match become players again.
        for (const player of this.players.values()) player.isSpectator = false;
        this.clearPhaseTimer();
        this.broadcastState();
    }

    /* ---------------- client actions delegated to the round ---------- */

    markReady(playerId: string, roundId: number, attempt: number): RoomResult<null> {
        const round = this.requireRound(roundId);
        if (!round.ok) return round;
        const outcome = round.data.markReady(playerId, attempt);
        return outcome.ok
            ? { ok: true, data: null }
            : fail(outcome.code, outcome.message);
    }

    submitResult(
        playerId: string,
        roundId: number,
        attempt: number,
        payload: unknown
    ): RoomResult<null> {
        const round = this.requireRound(roundId);
        if (!round.ok) return round;
        const outcome = round.data.submitResult(playerId, attempt, payload);
        return outcome.ok
            ? { ok: true, data: null }
            : fail(outcome.code, outcome.message);
    }

    submitProgress(
        playerId: string,
        roundId: number,
        attempt: number,
        payload: unknown
    ): void {
        if (this.round === null || this.round.roundId !== roundId) return;
        this.round.submitProgress(playerId, attempt, payload);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private requireRound(roundId: number): RoomResult<SelfTimedRound<any, any>> {
        if (this.round === null) {
            return fail('wrong_phase', 'No round is running.');
        }
        // A message tagged with an old roundId is thrown away rather than
        // allowed to confuse the current round.
        if (this.round.roundId !== roundId) {
            return fail('stale_round', 'That round has already finished.');
        }
        return { ok: true, data: this.round };
    }

    /* ================================================================ */
    /* State                                                             */
    /* ================================================================ */

    /**
     * Built by listing the fields that go out, not by filtering a copy of the
     * room. A new piece of state has to be added here deliberately before
     * anyone can see it (section 10).
     */
    getState(): RoomStatePayload {
        const scores = new Map(
            (this.competition?.scoreRows() ?? []).map((row) => [row.playerId, row.points])
        );

        const players: PlayerView[] = [...this.players.values()]
            .sort((a, b) => a.joinedAt - b.joinedAt)
            .map((player) => ({
                playerId: player.playerId,
                name: player.name,
                connected: player.connected,
                isOwner: player.playerId === this.ownerId,
                isSpectator: player.isSpectator,
                points: scores.get(player.playerId) ?? 0
            }));

        return {
            roomCode: this.roomCode,
            phase: this.phase,
            ownerId: this.ownerId ?? '',
            players,
            mode: this.mode,
            playlist: this.competition
                ? [...this.competition.playlist]
                : [...this.customPlaylist],
            catalog: GAME_IDS.map((id) => GAME_CATALOG[id]),
            round: this.roundView(),
            serverTimeMs: monotonicNowMs(),
            minPlayers: ROOM.MIN_PLAYERS,
            maxPlayers: ROOM.MAX_PLAYERS
        };
    }

    private roundView(): RoundView {
        const described = this.round?.describe() ?? this.lastRoundView;
        if (!described) {
            return {
                phase: 'idle',
                roundId: this.competition?.roundId ?? 0,
                attempt: 0,
                gameId: null,
                gameIndex: 0,
                totalGames: this.competition?.playlist.length ?? 0,
                roundInGame: 0,
                roundsPerGame: COMPETITION.ROUNDS_PER_GAME,
                isTiebreak: false,
                participants: [],
                ready: [],
                waitingFor: [],
                startAtServerMs: null
            };
        }
        return { ...described, roundsPerGame: COMPETITION.ROUNDS_PER_GAME };
    }

    broadcastState(): void {
        if (this.destroyed) return;
        this.emitter.toRoom(ServerEvent.RoomState, this.getState());
    }

    /**
     * A reconnecting client needs the round data it missed. It is already out
     * of the current attempt — the round stopped waiting on it when the socket
     * dropped — but it should still see what everyone else is playing.
     */
    private sendRoundSnapshot(player: Player): void {
        if (!player.socketId || this.round === null) return;
        const snapshot = this.round.snapshotRoundData();
        if (snapshot) {
            this.emitter.toSocket(player.socketId, ServerEvent.RoundData, snapshot);
        }
    }

    hasPlayer(playerId: string): boolean {
        return this.players.has(playerId);
    }

    private activePlayers(): Player[] {
        return [...this.players.values()].filter((p) => p.connected && !p.isSpectator);
    }

    private setPhaseTimer(fn: () => void, delayMs: number): void {
        this.clearPhaseTimer();
        this.phaseTimer = setTimeout(() => {
            this.phaseTimer = null;
            fn();
        }, Math.max(0, delayMs));
    }

    private clearPhaseTimer(): void {
        if (this.phaseTimer) clearTimeout(this.phaseTimer);
        this.phaseTimer = null;
    }

    private clearDropTimer(player: Player): void {
        if (player.dropTimer) clearTimeout(player.dropTimer);
        player.dropTimer = null;
    }

    destroy(): void {
        this.destroyed = true;
        this.clearPhaseTimer();
        this.round?.cancel();
        this.round = null;
        for (const player of this.players.values()) this.clearDropTimer(player);
        this.emitter.toRoom(ServerEvent.RoomClosed, { roomCode: this.roomCode });
        this.players.clear();
    }
}
