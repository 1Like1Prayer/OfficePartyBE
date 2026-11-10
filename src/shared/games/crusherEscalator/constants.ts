/**
 * Crusher Escalator tunables. Everything a designer might adjust while
 * playtesting lives here, so the rules code contains no magic numbers.
 */

export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

export const CRUSHER_ESCALATOR = {
    /** Two scoring rounds per game; each race decides one point. */
    ROUNDS_PER_GAME: 2,

    /** Every player starts the race on this many points. */
    STARTING_SCORE: 0,
    /** Points awarded for pressing the arrow that is currently showing. */
    POINTS_PER_CORRECT_INPUT: 1,

    /**
     * A player is crushed when the leader's score is this many points above
     * theirs. The leader is whoever has the highest score.
     */
    ELIMINATION_GAP: 8,

    /** Symbols in a player's stream before it loops back to the start. */
    STREAM_LENGTH: 30,

    /**
     * Breathing room after the race is decided (one player left) for the
     * ending animations, before the next round is scheduled.
     */
    FINISH_ANIMATION_MS: 4_000,

    /**
     * With more players than this, the opening stage splits them into two
     * heats. It runs until this many players are left, who then race again in
     * one group for the final.
     */
    FINALISTS: 6,
    /**
     * The heats get a longer intro than a normal race: the usual countdown
     * plus this much extra, for the animation that sorts players into heats.
     */
    HEATS_EXTRA_ANIMATION_MS: 4_000,
    /** After the heats, how long the round pauses before the final loads. */
    FINAL_PAUSE_MS: 3_000,
    /** The final's run-up is shorter than usual: finalists have just been watching. */
    FINAL_START_LEAD_MS: 2_000,
    FINAL_COUNTDOWN_MS: 3_000,

    /** The race ends at this time even if several players are still alive. */
    MAX_RACE_MS: 90_000,
    /** Extra wait for stragglers before the server scores without them. */
    RESULT_GRACE_MS: 5_000,
    /**
     * Upper bound on inputs in one result. Bounds the message size; far above
     * what a person can press in MAX_RACE_MS.
     */
    MAX_INPUTS: 2_000
} as const;
