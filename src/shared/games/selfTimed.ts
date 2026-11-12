/**
 * Types every self-timed game shares. The runner in game/selfTimedRound.ts
 * is written against these, so adding Cube Counter or Type Racer means
 * writing a module that satisfies SelfTimedGameModule and nothing else.
 */

export interface ResultEntry<TResult> {
    playerId: string;
    result: TResult;
}

/**
 * One player's standing in a scoring round. `rank` is 1-based and shared by
 * tied players (1, 1, 3). `detail` is whatever the game wants shown on the
 * results screen and is safe to broadcast — it is only built after the
 * reveal, so it never leaks a result early.
 */
export interface RankedEntry {
    playerId: string;
    rank: number;
    reported: boolean;
    detail: Record<string, number | string | boolean>;
}

export interface RoundContext {
    /** 1-based round within the game. */
    roundInGame: number;
    roundsPerGame: number;
    /**
     * The players this attempt is for. Games that give each player their own
     * content (Crusher Escalator's arrow streams) build it from this; a
     * tiebreaker attempt lists only the tied players.
     */
    playerIds: readonly string[];
    /** 0 for the opening attempt; later attempts are stages or tiebreakers. */
    attempt: number;
}

/** How long the run-up to an attempt's start lasts. */
export interface AttemptTiming {
    /** How far ahead the start is scheduled once everyone is ready. */
    startLeadMs: number;
    /** The "3, 2, 1" the clients show before the clock runs. */
    countdownMs: number;
}

/**
 * A game with stages (heats, then a final) asks the runner for another
 * attempt with a new set of players, instead of waiting for a tie.
 */
export interface StageAdvance {
    /** Who plays the next stage. */
    participants: string[];
    /** Pause between the stage ending and the next one loading. */
    pauseMs: number;
    /** Run-up for the next stage, if it should differ from the usual. */
    timing?: AttemptTiming;
}

export interface SelfTimedGameModule<TRound, TResult> {
    readonly id: string;
    readonly title: string;
    readonly kind: 'self-timed';

    /**
     * How many scoring rounds this game is played for in a competition. Each
     * is worth one point. A game with internal rounds of its own (Cube
     * Counter's puzzles) still counts as one scoring round.
     */
    readonly roundsPerGame: number;

    /**
     * How long clients get to play the game's ending animation once a round is
     * decided, before the results screen runs its normal course and the next
     * round is scheduled. Omit for games that need none.
     */
    readonly finishAnimationMs?: number;

    /** Public round data. Must contain nothing a player shouldn't see. */
    createRoundData(context: RoundContext): TRound;

    /** Parse an untrusted client result. Returns null for anything malformed. */
    parseResult(raw: unknown, round: TRound): TResult | null;

    /** Parse an untrusted progress update, or null to drop it. */
    parseProgress(raw: unknown, round: TRound): Record<string, number> | null;

    /**
     * Optional. What the server itself can tell everyone about a player once
     * their result is in, shown like a progress update. It does not depend on
     * the player's own progress messages arriving, so it is a reliable way to
     * tell the room that someone is out. Return null to say nothing.
     */
    progressFromResult?(result: TResult, round: TRound): Record<string, number> | null;

    /**
     * Optional, for games that end before everyone has finished (Crusher
     * Escalator, Log Dodge). Called after each result comes in. Return true
     * once enough players have reported that the round must be over, and the
     * runner tells the rest to stop and report. They would otherwise keep
     * playing, because they only learn the round is over by watching others.
     * Only the number of reports is passed in: the server decides nothing
     * from it, the final ranking still replays every result.
     */
    shouldCloseEarly?(reportedCount: number, participantCount: number, round: TRound): boolean;

    /** How long after the start the server waits before resolving without stragglers. */
    resultTimeoutMs(round: TRound): number;

    /**
     * Order the reported results. Entries that share rank 1 are a genuine tie
     * and the runner will send them to a tiebreaker.
     */
    rank(entries: ResultEntry<TResult>[], round: TRound): RankedEntry[];

    /**
     * Optional. Answer a request a player makes mid-round, for games where
     * something must be decided by the server while the round is running (Type
     * Racer Roulette's dice). Return the reply for the player, or null if the
     * request is malformed.
     */
    handleAction?(round: TRound, playerId: string, raw: unknown): unknown | null;

    /**
     * Optional. A different run-up for the opening attempt, decided from its
     * round data (e.g. heats get a longer intro than a plain race). Return
     * null to use the platform default.
     */
    openingTiming?(round: TRound): AttemptTiming | null;

    /**
     * Optional. After ranking an attempt, say whether the scoring round goes
     * on to another stage. Checked before the tie rule, so a stage advance is
     * never mistaken for a tie. Return null to finish the round.
     */
    nextStage?(ranked: RankedEntry[], round: TRound): StageAdvance | null;
}
