/**
 * The wire protocol. Both sides import this file, so a message shape can
 * only change in one place.
 *
 * Envelope: every round-scoped message carries `roundId` (a counter that
 * increments each scoring round) and `attempt` (which tiebreaker within that
 * round). Together they let the server throw away a message from a round the
 * room has already moved past, instead of letting it confuse the current one.
 * The server knows who sent a message from the socket, so nothing carries a
 * sender.
 */

import type { GameId, GameMeta } from './games/catalog';
import type { RankedEntry } from './games/selfTimed';

export const GAME_NAMESPACE = '/game';

/** Client -> server. */
export const ClientEvent = {
    CreateRoom: 'room:create',
    JoinRoom: 'room:join',
    LeaveRoom: 'room:leave',
    SetName: 'room:setName',
    RequestState: 'room:requestState',
    SetMode: 'lobby:setMode',
    SetRounds: 'lobby:setRounds',
    SetReady: 'lobby:ready',
    StartCompetition: 'lobby:start',
    SkipResults: 'competition:skip',
    Ready: 'round:ready',
    Progress: 'round:progress',
    SubmitResult: 'round:result',
    Ping: 'time:ping'
} as const;

/** Server -> client. */
export const ServerEvent = {
    RoomState: 'room:state',
    PlayerJoined: 'room:playerJoined',
    PlayerLeft: 'room:playerLeft',
    PlayerReconnected: 'room:playerReconnected',
    OwnerChanged: 'room:ownerChanged',
    RoomClosed: 'room:closed',
    Playlist: 'competition:playlist',
    GameStarting: 'competition:gameStarting',
    Scores: 'competition:scores',
    Leaderboard: 'competition:leaderboard',
    RoundData: 'round:data',
    ReadyState: 'round:readyState',
    StartAt: 'round:startAt',
    RoundProgress: 'round:progress',
    RoundResults: 'round:results',
    ProtocolMismatch: 'protocol:mismatch',
    Error: 'error'
} as const;

export type ClientEventName = (typeof ClientEvent)[keyof typeof ClientEvent];
export type ServerEventName = (typeof ServerEvent)[keyof typeof ServerEvent];

/* ------------------------------------------------------------------ */
/* Acknowledgements                                                     */
/* ------------------------------------------------------------------ */

export type Ack<T> =
    | { ok: true; data: T }
    | { ok: false; code: ErrorCode; message: string };

export type ErrorCode =
    | 'room_not_found'
    | 'room_full'
    | 'competition_in_progress'
    | 'not_owner'
    | 'not_in_room'
    | 'not_enough_players'
    | 'players_not_ready'
    | 'invalid_playlist'
    | 'invalid_rounds'
    | 'invalid_payload'
    | 'wrong_phase'
    | 'stale_round'
    | 'duplicate_result'
    | 'rate_limited'
    | 'internal';

/* ------------------------------------------------------------------ */
/* Room                                                                 */
/* ------------------------------------------------------------------ */

export type RoomPhase = 'lobby' | 'competition' | 'leaderboard';

/**
 * The round's own lifecycle, from section 6:
 * Loading -> ReadyCheck -> Start -> Playing -> Results.
 *
 * `countdown` is the 3, 2, 1 the client shows between the scheduled start and
 * the clock running. Nothing is timed during it and results are not accepted
 * yet — the round is not counting.
 */
export type RoundPhase =
    | 'idle'
    | 'loading'
    | 'ready-check'
    | 'starting'
    | 'countdown'
    | 'playing'
    | 'results';

export type PlaylistMode = 'random' | 'custom';

export interface PlayerView {
    playerId: string;
    name: string;
    connected: boolean;
    isOwner: boolean;
    /** Joined after the competition started, so they watch rather than play. */
    isSpectator: boolean;
    /**
     * Pressed ready in the lobby. The owner is always ready — they start the
     * match, so there is nothing for them to signal.
     */
    ready: boolean;
    points: number;
}

/**
 * Everything the lobby screen needs to render itself: who the room is waiting
 * on, whether start is available, and the settings the owner can change.
 */
export interface LobbyView {
    /** Connected players who are ready. Always includes the owner. */
    ready: string[];
    /** Connected players the room is still waiting on. */
    waitingFor: string[];
    allReady: boolean;
    /** True when the owner can press start right now. */
    canStart: boolean;
    /** Why start is unavailable, or null when it is. */
    blockedReason: StartBlockedReason | null;
    roundsPerGame: number;
    /** The values roundsPerGame may be set to. */
    roundsPerGameOptions: number[];
    /** The set list the owner picks from — games that are actually built. */
    playableGames: GameId[];
}

export type StartBlockedReason =
    | 'not_enough_players'
    | 'players_not_ready'
    | 'invalid_playlist';

export interface RoundView {
    phase: RoundPhase;
    roundId: number;
    attempt: number;
    gameId: GameId | null;
    /** Which game of the playlist, 1-based, and which of its two rounds. */
    gameIndex: number;
    totalGames: number;
    roundInGame: number;
    roundsPerGame: number;
    isTiebreak: boolean;
    participants: string[];
    ready: string[];
    waitingFor: string[];
    /** Server monotonic time the round starts at, once scheduled. */
    startAtServerMs: number | null;
}

export interface RoomStatePayload {
    roomCode: string;
    phase: RoomPhase;
    ownerId: string;
    players: PlayerView[];
    mode: PlaylistMode;
    playlist: GameId[];
    catalog: GameMeta[];
    lobby: LobbyView;
    round: RoundView;
    /** Current server monotonic time, so a late joiner can sync its offset. */
    serverTimeMs: number;
    minPlayers: number;
    maxPlayers: number;
}

export interface JoinAckData {
    playerId: string;
    roomCode: string;
    state: RoomStatePayload;
    /** True when this join reclaimed an existing slot rather than taking a new one. */
    reconnected: boolean;
}

/* ------------------------------------------------------------------ */
/* Round messages                                                       */
/* ------------------------------------------------------------------ */

export interface RoundEnvelope {
    roundId: number;
    attempt: number;
}

export interface RoundDataPayload<TRound = unknown> extends RoundEnvelope {
    gameId: GameId;
    /** Public round data only — see section 10 on hidden state. */
    data: TRound;
    isTiebreak: boolean;
    participants: string[];
    resultTimeoutMs: number;
    gameIndex: number;
    totalGames: number;
    roundInGame: number;
}

export interface ReadyStatePayload extends RoundEnvelope {
    ready: string[];
    waitingFor: string[];
    /** When the ready check gives up and starts without the stragglers. */
    deadlineServerMs: number;
}

export interface StartAtPayload extends RoundEnvelope {
    /**
     * Server monotonic time the round starts and the countdown begins. The
     * client converts it to a local time using its own measured offset — that
     * conversion is the only thing ping is for.
     */
    startAtServerMs: number;
    /** How long the client shows "3, 2, 1" for. */
    countdownMs: number;
    /**
     * When the clock actually runs: startAtServerMs + countdownMs. This is the
     * zero the client measures its elapsed time from, and the moment the
     * server starts counting toward the result deadline.
     */
    timingStartsAtServerMs: number;
    serverTimeMs: number;
}

export interface ProgressPayload extends RoundEnvelope {
    playerId: string;
    progress: Record<string, number>;
}

export interface RoundResultsPayload extends RoundEnvelope {
    gameId: GameId;
    /** Revealed together, once everyone is in or the timeout has expired. */
    ranked: RankedEntry[];
    /** Players who never reported. They rank last and score nothing. */
    noShow: string[];
    winnerId: string | null;
    /** A tie survived every tiebreaker and the winner was drawn at random. */
    decidedByCoinFlip: boolean;
    /** True on the last attempt of the scoring round, i.e. a point was awarded. */
    isFinal: boolean;
    scores: ScoreRow[];
    nextRoundAtServerMs: number | null;
}

export interface ScoreRow {
    playerId: string;
    points: number;
}

export interface LeaderboardRow extends ScoreRow {
    rank: number;
}

export interface PlaylistPayload {
    mode: PlaylistMode;
    playlist: GameId[];
    roundsPerGame: number;
    totalRounds: number;
}

export interface GameStartingPayload extends RoundEnvelope {
    gameId: GameId;
    title: string;
    gameIndex: number;
    totalGames: number;
    roundInGame: number;
}

export interface LeaderboardPayload {
    rows: LeaderboardRow[];
    /** Tied final scores are left tied; there is no overall tiebreaker. */
    tied: boolean;
}

export interface PingAckData {
    serverTimeMs: number;
}

export interface ErrorPayload {
    code: ErrorCode;
    message: string;
}
