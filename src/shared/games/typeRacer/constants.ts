/**
 * Type Racer Roulette tunables. Everything a designer might adjust while
 * playtesting lives here, so the rules code contains no magic numbers.
 */

/**
 * A race opens with a gentle warm-up and then gets hard: 1 or 2 easy
 * paragraphs first, followed by 3 hard ones, so 4 or 5 paragraphs in all.
 */
const MIN_EASY_PARAGRAPHS = 1;
const MAX_EASY_PARAGRAPHS = 2;
const HARD_PARAGRAPHS = 3;

export const TYPE_RACER = {
    /** Two scoring rounds per game; each race decides one point. */
    ROUNDS_PER_GAME: 2,

    MIN_EASY_PARAGRAPHS,
    MAX_EASY_PARAGRAPHS,
    HARD_PARAGRAPHS,
    MIN_PARAGRAPHS: MIN_EASY_PARAGRAPHS + HARD_PARAGRAPHS,
    MAX_PARAGRAPHS: MAX_EASY_PARAGRAPHS + HARD_PARAGRAPHS,

    /** Mistakes in one paragraph that cast the dice. */
    STRIKES_TO_ROLL: 3,
    /** After surviving a roll, the player drops back to this many strikes. */
    STRIKES_AFTER_SURVIVING: 2,

    DICE_SIDES: 6,
    /** The first roll has this many skull sides; the rest are hearts. */
    STARTING_SKULLS: 1,
    /**
     * Every survived roll adds a skull side, up to every side of the die. A
     * die with all six sides skulls is certain death, so a player can survive
     * at most five rolls.
     */
    MAX_SKULLS: 6,

    /** Time allowed on each paragraph, counted from when typing on it opens. */
    PARAGRAPH_TIME_LIMIT_MS: 180_000,
    /**
     * A pause after each paragraph (not after the last) for a brief break and
     * animations. Typing is closed during it, and it counts toward everyone's
     * finish time equally. The paragraph's own time limit starts after it.
     */
    PARAGRAPH_PAUSE_MS: 7_000,
    /** Extra wait for stragglers before the server scores without them. */
    RESULT_GRACE_MS: 10_000,

    /**
     * Time for the winner's celebration animation once the race is decided,
     * before the results screen's normal display time and the next round.
     */
    FINISH_ANIMATION_MS: 5_000,

    /** Bounds on untrusted input. */
    MAX_EVENTS: 5_000,
    MAX_ROLL_INDEX: 200
} as const;

/** The latest a timestamp in a result can be: every paragraph run to its limit, with every pause. */
export const MAX_RACE_MS =
    TYPE_RACER.MAX_PARAGRAPHS * TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS +
    (TYPE_RACER.MAX_PARAGRAPHS - 1) * TYPE_RACER.PARAGRAPH_PAUSE_MS;
