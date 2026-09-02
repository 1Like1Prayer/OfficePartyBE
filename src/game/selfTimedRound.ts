/**
 * The self-timed round runner (section 8.1).
 *
 * Five of the ten games use this. The server hands out the round data, waits
 * for everyone to be ready, picks a start time a second or two out, and
 * collects what comes back. It never measures anything itself, so latency
 * cannot reach the outcome.
 *
 * Tiebreakers are internal: a scoring round may run several attempts, but it
 * hands back exactly one winner (section 6). The room only hears about the
 * final one.
 *
 * The runner has no socket dependency: it emits through callbacks, so the
 * room decides how results reach the wire.
 */

import { SELF_TIMED } from '../shared/constants';
import type {
    RankedEntry,
    ResultEntry,
    SelfTimedGameModule
} from '../shared/games/selfTimed';
import type { GameId } from '../shared/games/catalog';
import type {
    ErrorCode,
    ProgressPayload,
    ReadyStatePayload,
    RoundDataPayload,
    RoundPhase,
    StartAtPayload
} from '../shared/protocol';
import { monotonicNowMs } from './clock';

/** How long the "it's a tie" screen shows before the tiebreaker begins. */
const TIEBREAK_DELAY_MS = 4_000;

export interface AttemptResolved {
    roundId: number;
    attempt: number;
    isTiebreak: boolean;
    ranked: RankedEntry[];
    noShow: string[];
    winnerId: string | null;
    decidedByCoinFlip: boolean;
    /** False when a tie sent this round to another attempt. */
    isFinal: boolean;
}

export interface SelfTimedRoundEvents {
    onRoundData(payload: RoundDataPayload): void;
    onReadyState(payload: ReadyStatePayload): void;
    onStartAt(payload: StartAtPayload): void;
    onProgress(payload: ProgressPayload): void;
    onAttemptResolved(payload: AttemptResolved): void;
}

export interface SelfTimedRoundOptions<TRound, TResult> {
    module: SelfTimedGameModule<TRound, TResult>;
    gameId: GameId;
    roundId: number;
    /** Position in the competition, carried through for the client's HUD. */
    gameIndex: number;
    totalGames: number;
    roundInGame: number;
    events: SelfTimedRoundEvents;
}

export type SubmitOutcome =
    | { ok: true }
    | { ok: false; code: ErrorCode; message: string };

export class SelfTimedRound<TRound, TResult> {
    readonly roundId: number;
    readonly gameId: GameId;

    private readonly module: SelfTimedGameModule<TRound, TResult>;
    private readonly events: SelfTimedRoundEvents;
    private readonly gameIndex: number;
    private readonly totalGames: number;
    private readonly roundInGame: number;

    private phase: RoundPhase = 'idle';
    private attemptIndex = 0;
    private isTiebreak = false;
    private round: TRound | null = null;
    private participants = new Set<string>();
    private ready = new Set<string>();
    private results = new Map<string, TResult>();
    private lastProgressAt = new Map<string, number>();
    private startAtServerMs: number | null = null;
    private readyDeadlineMs = 0;
    private timer: NodeJS.Timeout | null = null;
    private cancelled = false;

    constructor(options: SelfTimedRoundOptions<TRound, TResult>) {
        this.module = options.module;
        this.gameId = options.gameId;
        this.roundId = options.roundId;
        this.gameIndex = options.gameIndex;
        this.totalGames = options.totalGames;
        this.roundInGame = options.roundInGame;
        this.events = options.events;
    }

    /* -------------------------------------------------------------- */
    /* Lifecycle                                                        */
    /* -------------------------------------------------------------- */

    begin(participants: string[]): void {
        this.participants = new Set(participants);
        this.startAttempt(0, false);
    }

    /** Stop everything. Used when the room is destroyed or the match aborted. */
    cancel(): void {
        this.cancelled = true;
        this.clearTimer();
        this.phase = 'idle';
    }

    private startAttempt(attempt: number, isTiebreak: boolean): void {
        if (this.cancelled) return;

        this.attemptIndex = attempt;
        this.isTiebreak = isTiebreak;
        this.round = this.module.createRoundData();
        this.ready.clear();
        this.results.clear();
        this.lastProgressAt.clear();
        this.startAtServerMs = null;

        // Loading: the round data goes out and clients build whatever they need.
        this.phase = 'loading';
        this.events.onRoundData({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            data: this.round,
            isTiebreak,
            participants: [...this.participants],
            resultTimeoutMs: this.module.resultTimeoutMs(this.round),
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame
        });

        // Ready check: nothing is scheduled until everyone has acknowledged.
        this.phase = 'ready-check';
        this.readyDeadlineMs =
            monotonicNowMs() + SELF_TIMED.READY_CHECK_TIMEOUT_MS;
        this.emitReadyState();
        this.setTimer(
            () => this.onReadyCheckTimeout(),
            SELF_TIMED.READY_CHECK_TIMEOUT_MS
        );

        // An empty attempt (everyone left) resolves immediately rather than hanging.
        if (this.participants.size === 0) this.resolve();
    }

    /* -------------------------------------------------------------- */
    /* Client actions                                                   */
    /* -------------------------------------------------------------- */

    markReady(playerId: string, attempt: number): SubmitOutcome {
        if (attempt !== this.attemptIndex) {
            return { ok: false, code: 'stale_round', message: 'Ready for a past attempt.' };
        }
        if (this.phase !== 'ready-check') {
            return { ok: false, code: 'wrong_phase', message: 'Not in a ready check.' };
        }
        if (!this.participants.has(playerId)) {
            return { ok: false, code: 'not_in_room', message: 'Not playing this round.' };
        }
        if (this.ready.has(playerId)) return { ok: true };

        this.ready.add(playerId);
        this.emitReadyState();
        if (this.allReady()) this.scheduleStart();
        return { ok: true };
    }

    submitResult(
        playerId: string,
        attempt: number,
        raw: unknown
    ): SubmitOutcome {
        if (attempt !== this.attemptIndex) {
            return { ok: false, code: 'stale_round', message: 'Result for a past attempt.' };
        }
        if (this.phase !== 'playing' || this.round === null) {
            return { ok: false, code: 'wrong_phase', message: 'Round is not running.' };
        }
        if (!this.participants.has(playerId)) {
            return { ok: false, code: 'not_in_room', message: 'Not playing this round.' };
        }
        // Keep the first report per player per attempt, ignore repeats.
        if (this.results.has(playerId)) {
            return { ok: false, code: 'duplicate_result', message: 'Already reported.' };
        }

        const parsed = this.module.parseResult(raw, this.round);
        if (parsed === null) {
            return { ok: false, code: 'invalid_payload', message: 'Malformed result.' };
        }

        this.results.set(playerId, parsed);
        if (this.pendingPlayers().length === 0) this.resolve();
        return { ok: true };
    }

    /** Display-only, rate limited, and never allowed to affect the outcome. */
    submitProgress(playerId: string, attempt: number, raw: unknown): void {
        if (
            attempt !== this.attemptIndex ||
            this.phase !== 'playing' ||
            this.round === null ||
            !this.participants.has(playerId)
        ) {
            return;
        }

        const now = monotonicNowMs();
        const last = this.lastProgressAt.get(playerId) ?? -Infinity;
        if (now - last < SELF_TIMED.PROGRESS_MIN_INTERVAL_MS) return;

        const progress = this.module.parseProgress(raw, this.round);
        if (progress === null) return;

        this.lastProgressAt.set(playerId, now);
        this.events.onProgress({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            playerId,
            progress
        });
    }

    /**
     * A player disconnected or left. They stop being waited on, but a result
     * they already submitted still counts.
     */
    dropParticipant(playerId: string): void {
        if (!this.participants.has(playerId)) return;
        this.participants.delete(playerId);
        this.ready.delete(playerId);

        if (this.phase === 'ready-check') {
            this.emitReadyState();
            if (this.participants.size === 0) this.resolve();
            else if (this.allReady()) this.scheduleStart();
        } else if (this.phase === 'playing') {
            if (this.pendingPlayers().length === 0) this.resolve();
        }
    }

    /* -------------------------------------------------------------- */
    /* Internals                                                        */
    /* -------------------------------------------------------------- */

    private allReady(): boolean {
        if (this.participants.size === 0) return false;
        for (const playerId of this.participants) {
            if (!this.ready.has(playerId)) return false;
        }
        return true;
    }

    private pendingPlayers(): string[] {
        return [...this.participants].filter((id) => !this.results.has(id));
    }

    private emitReadyState(): void {
        this.events.onReadyState({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            ready: [...this.ready],
            waitingFor: [...this.participants].filter((id) => !this.ready.has(id)),
            deadlineServerMs: this.readyDeadlineMs
        });
    }

    private scheduleStart(): void {
        this.clearTimer();
        this.phase = 'starting';
        const now = monotonicNowMs();
        this.startAtServerMs = now + SELF_TIMED.START_LEAD_MS;
        this.events.onStartAt({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            startAtServerMs: this.startAtServerMs,
            serverTimeMs: now
        });
        this.setTimer(() => this.beginPlaying(), SELF_TIMED.START_LEAD_MS);
    }

    /**
     * Someone never acknowledged. Rather than hanging the room, they drop out
     * of the attempt and are recorded as a no-show.
     */
    private onReadyCheckTimeout(): void {
        if (this.phase !== 'ready-check') return;
        for (const playerId of [...this.participants]) {
            if (!this.ready.has(playerId)) this.participants.delete(playerId);
        }
        if (this.participants.size === 0) {
            this.resolve();
            return;
        }
        this.emitReadyState();
        this.scheduleStart();
    }

    private beginPlaying(): void {
        if (this.phase !== 'starting' || this.round === null) return;
        this.phase = 'playing';
        this.setTimer(() => this.resolve(), this.module.resultTimeoutMs(this.round));
    }

    private resolve(): void {
        if (this.cancelled || this.phase === 'results' || this.round === null) return;
        this.clearTimer();
        this.phase = 'results';

        const entries: ResultEntry<TResult>[] = [...this.results].map(
            ([playerId, result]) => ({ playerId, result })
        );
        const ranked = this.module.rank(entries, this.round);
        const noShow = this.pendingPlayers();
        const leaders = ranked.filter((row) => row.rank === 1).map((r) => r.playerId);

        const canRetry =
            leaders.length > 1 &&
            this.attemptIndex + 1 < SELF_TIMED.MAX_TIEBREAK_ATTEMPTS;

        if (canRetry) {
            // A tie is the game's business: run another attempt among just
            // those players and still hand back one winner.
            this.events.onAttemptResolved({
                roundId: this.roundId,
                attempt: this.attemptIndex,
                isTiebreak: this.isTiebreak,
                ranked,
                noShow,
                winnerId: null,
                decidedByCoinFlip: false,
                isFinal: false
            });
            const tied = [...leaders];
            const nextAttempt = this.attemptIndex + 1;
            this.setTimer(() => {
                this.participants = new Set(tied);
                this.startAttempt(nextAttempt, true);
            }, TIEBREAK_DELAY_MS);
            return;
        }

        let winnerId: string | null = null;
        let decidedByCoinFlip = false;
        if (leaders.length === 1) {
            winnerId = leaders[0]!;
        } else if (leaders.length > 1) {
            // Tiebreakers exhausted. Draw, and say so rather than pretending.
            winnerId = leaders[Math.floor(Math.random() * leaders.length)]!;
            decidedByCoinFlip = true;
        }

        this.events.onAttemptResolved({
            roundId: this.roundId,
            attempt: this.attemptIndex,
            isTiebreak: this.isTiebreak,
            ranked,
            noShow,
            winnerId,
            decidedByCoinFlip,
            isFinal: true
        });
    }

    private setTimer(fn: () => void, delayMs: number): void {
        this.clearTimer();
        this.timer = setTimeout(fn, Math.max(0, delayMs));
    }

    private clearTimer(): void {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
    }

    /* -------------------------------------------------------------- */
    /* Views                                                            */
    /* -------------------------------------------------------------- */

    describe() {
        return {
            phase: this.phase,
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame,
            isTiebreak: this.isTiebreak,
            participants: [...this.participants],
            ready: [...this.ready],
            waitingFor: [...this.participants].filter((id) => !this.ready.has(id)),
            startAtServerMs: this.startAtServerMs
        };
    }

    /** Round data payload rebuilt for a client that reconnected mid-round. */
    snapshotRoundData(): RoundDataPayload | null {
        if (this.round === null) return null;
        return {
            roundId: this.roundId,
            attempt: this.attemptIndex,
            gameId: this.gameId,
            data: this.round,
            isTiebreak: this.isTiebreak,
            participants: [...this.participants],
            resultTimeoutMs: this.module.resultTimeoutMs(this.round),
            gameIndex: this.gameIndex,
            totalGames: this.totalGames,
            roundInGame: this.roundInGame
        };
    }
}
