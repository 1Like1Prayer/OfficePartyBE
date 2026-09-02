/**
 * Platform-wide tunables. These are the answers to section 17 of the
 * architecture plan ("decisions to make before building"). They live in
 * shared/ because the client needs several of them to render honestly
 * (how long a ready check waits, how long results stay up).
 */

/** Bumped whenever a message shape changes. Mismatched clients are asked to reload. */
export const PROTOCOL_VERSION = 3;

export const ROOM = {
    /** Room codes are 4 characters from an unambiguous alphabet. */
    CODE_LENGTH: 4,
    CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 12,
    /** Name length bound, so a runaway client cannot post a novel. */
    MAX_NAME_LENGTH: 24,
    /** A disconnected player keeps their slot this long before being dropped. */
    DISCONNECT_GRACE_MS: 30_000,
    /** An empty room is reaped after this long. */
    EMPTY_TTL_MS: 5 * 60_000,
    /** How often the manager sweeps for empty/expired rooms. */
    SWEEP_INTERVAL_MS: 30_000
} as const;

export const COMPETITION = {
    /**
     * How many times each selected game is played. Each play is a scoring
     * round worth one point. The owner picks from ROUNDS_PER_GAME_OPTIONS.
     */
    DEFAULT_ROUNDS_PER_GAME: 2,
    ROUNDS_PER_GAME_OPTIONS: [2, 3, 5] as const,
    /** How many games random mode picks (capped by how many are implemented). */
    RANDOM_PLAYLIST_SIZE: 5,
    MAX_CUSTOM_PLAYLIST_SIZE: 10,
    /** How long the results screen shows before the next round starts. */
    RESULT_DISPLAY_MS: 6_000,
    /** How long the final leaderboard shows before the room returns to lobby. */
    LEADERBOARD_DISPLAY_MS: 15_000
} as const;

export const SELF_TIMED = {
    /**
     * How far ahead a start is scheduled once everyone is ready. Long enough to
     * absorb normal latency, short enough not to feel like a stall.
     */
    START_LEAD_MS: 2_000,
    /**
     * If someone never acknowledges the ready check we start without them
     * rather than hanging the room.
     */
    READY_CHECK_TIMEOUT_MS: 20_000,
    /**
     * The visible "3, 2, 1" between the round starting and the clock actually
     * running. The server does not start counting until it has elapsed, so a
     * player's timing window is the same interval they were shown.
     */
    COUNTDOWN_MS: 3_000,
    /** Clients send progress at roughly this rate, purely for display. */
    PROGRESS_HZ: 5,
    /** Server-side floor on the gap between progress messages from one player. */
    PROGRESS_MIN_INTERVAL_MS: 120,
    /** A scoring round runs at most this many tiebreakers before coin-flipping. */
    MAX_TIEBREAK_ATTEMPTS: 3
} as const;
