/**
 * Log Dodge tunables. Everything a designer might adjust while playtesting
 * lives here, so the rules code contains no magic numbers.
 */

export const LOG_HEIGHTS = ['low', 'high'] as const;
export const ACTIONS = ['jump', 'duck'] as const;

/** Which action dodges which log: jump a low log, duck a high one. */
export const COUNTER_ACTION = {
    low: 'jump',
    high: 'duck'
} as const;

export const LOG_DODGE = {
    /** Two scoring rounds per game, each with its own schedule and one winner. */
    ROUNDS_PER_GAME: 2,

    /** Everyone still standing at this time has survived. */
    DURATION_MS: 60_000,
    /** The third hit knocks a player out. */
    MAX_HITS: 3,

    /**
     * A press dodges a log if it is the right action and lands within this
     * many ms either side of the log's arrival time. A log not dodged by the
     * time its window closes is a hit.
     */
    HIT_WINDOW_MS: 500,
    /**
     * After a press, further presses within this many ms are ignored. This is
     * what stops a player mashing both buttons to cover every log. It
     * must not exceed MIN_GAP_MS, so every log can be dodged by pressing on
     * time, however tight the lineup gets.
     */
    INPUT_COOLDOWN_MS: 300,

    /** Nothing arrives before this, so players have a moment to settle in. */
    FIRST_ARRIVAL_MS: 4_000,
    /**
     * The difficulty ramp: from the first log to this time the round tightens
     * steadily; after it, the round stays at full difficulty.
     */
    HARD_FROM_MS: 40_000,
    /** Typical gap between consecutive arrivals at the start and once hard. */
    START_GAP_MS: 2_800,
    HARD_GAP_MS: 600,
    /** Random wobble applied to each gap, as a fraction of it (+-). */
    GAP_JITTER: 0.4,
    /** No two logs ever arrive closer together than this. */
    MIN_GAP_MS: 300,

    /**
     * How long a log is visible before it reaches the player, i.e. its
     * speed: short is fast, long is slow. Chosen per log, so logs move at
     * different speeds and a slow log can arrive after a fast one that appeared
     * later. Constant for the whole round; FIRST_ARRIVAL_MS is at least the
     * longest travel so no log has to appear before the round starts.
     */
    TRAVEL_RANGE_MS: [2_000, 4_000],

    /**
     * Approach angle in degrees, purely visual: it changes where the log
     * comes from on screen, never when or how it must be dodged. The range
     * widens as the round gets hard.
     */
    START_ANGLE_RANGE_DEG: 20,
    HARD_ANGLE_RANGE_DEG: 70,

    /** Upper bound on presses in one result. Bounds the message size. */
    MAX_INPUTS: 600,
    /** Extra wait for stragglers before the server scores without them. */
    RESULT_GRACE_MS: 5_000,
    /** After the round is decided (e.g. one player left), how long the win animation plays. */
    FINISH_ANIMATION_MS: 5_000
} as const;
