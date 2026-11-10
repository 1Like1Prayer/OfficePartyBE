import type { DIRECTIONS } from './constants';

export type Direction = (typeof DIRECTIONS)[number];

/** One player's looping sequence of arrows. */
export type ArrowStream = readonly Direction[];

/**
 * With many players the opening stage is two heats; the survivors then race
 * again, all in one group, in the final. With few players it is just a final.
 */
export type RaceStage = 'heats' | 'final';

/**
 * Public round data. The gap rule only compares players within the same
 * group, so a player in one heat can't crush a player in the other.
 */
export interface CrusherEscalatorRound {
    stage: RaceStage;
    /** Who races together. One group in the final, two in the heats. */
    groups: string[][];
    /**
     * Each participant's own stream, by player id. The streams are different
     * per player, but nothing in them helps anyone else.
     */
    streams: Record<string, Direction[]>;
}

/** One key press, timed by the client from when the race started. */
export interface Input {
    direction: Direction;
    atMs: number;
}

export interface CrusherEscalatorResult {
    /** Every press the player made, in order. The server judges them. */
    inputs: Input[];
    /** The tab was backgrounded mid-race, so local timing may be off. */
    timingSuspect: boolean;
}
