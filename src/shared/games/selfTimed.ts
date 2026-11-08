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

    /** Public round data. Must contain nothing a player shouldn't see. */
    createRoundData(context: RoundContext): TRound;

    /** Parse an untrusted client result. Returns null for anything malformed. */
    parseResult(raw: unknown, round: TRound): TResult | null;

    /** Parse an untrusted progress update, or null to drop it. */
    parseProgress(raw: unknown, round: TRound): Record<string, number> | null;

    /** How long after the start the server waits before resolving without stragglers. */
    resultTimeoutMs(round: TRound): number;

    /**
     * Order the reported results. Entries that share rank 1 are a genuine tie
     * and the runner will send them to a tiebreaker.
     */
    rank(entries: ResultEntry<TResult>[], round: TRound): RankedEntry[];
}
