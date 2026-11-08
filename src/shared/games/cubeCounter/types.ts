/**
 * Cube Counter data shapes.
 *
 * Coordinates: x and y address the 5x5 floor, z is the level (0 is the
 * floor). The camera looks at the grid from the high-x, high-y corner, so
 * every box shows its top face and its +x and +y side faces.
 */

/**
 * One block as the player counts it. Every box is exactly one level tall; a
 * "big" block is wider on the floor, never taller. That keeps a stack of three
 * cubes and a single tall block from looking identical.
 */
export interface Box {
    /** Lowest-coordinate corner of the footprint. */
    x: number;
    y: number;
    /** Level the box sits on. */
    z: number;
    /** Cells covered along x. */
    width: number;
    /** Cells covered along y. */
    depth: number;
}

export interface Puzzle {
    boxes: Box[];
    /** How long the scene is shown before it is hidden. */
    flashMs: number;
}

/** Public round data. The correct answer for a puzzle is `boxes.length`. */
export interface CubeCounterRound {
    puzzles: Puzzle[];
}

export interface Answer {
    /** What the player typed, or null if they ran out of time. */
    count: number | null;
    /** Client-measured time from the scene hiding to the answer, in integer ms. */
    answerMs: number;
}

export interface CubeCounterResult {
    /** One entry per puzzle, in order. */
    answers: Answer[];
    /** The tab was backgrounded mid-round, so local timing may be off. */
    timingSuspect: boolean;
}

export interface Cell {
    x: number;
    y: number;
}
