/**
 * How hard each puzzle in a round is. The ramp runs from the first puzzle to
 * the last and restarts every round, so round 2 begins easy again.
 */

import { CUBE_COUNTER } from './constants';

export interface DifficultyProfile {
    /** Target number of boxes. The generator may place fewer if space runs out. */
    boxCount: number;
    /** Widest footprint side a box may have. 1 means no big boxes at all. */
    maxFootprintSide: number;
    /** Chance each box is big. Zero whenever big boxes aren't allowed. */
    bigBoxChance: number;
    /** How many levels boxes may stack to. */
    maxStackLevels: number;
    flashMs: number;
}

const lerp = (from: number, to: number, progress: number): number =>
    from + (to - from) * progress;

/**
 * 0 at the first puzzle, 1 at the last. Curved (see RAMP_CURVE_EXPONENT) so
 * the round spends most of its puzzles at the hard end.
 */
const rampProgress = (puzzleIndex: number, puzzleCount: number): number =>
    puzzleCount <= 1
        ? 0
        : (puzzleIndex / (puzzleCount - 1)) ** CUBE_COUNTER.RAMP_CURVE_EXPONENT;

export const difficultyForPuzzle = (
    puzzleIndex: number,
    puzzleCount: number = CUBE_COUNTER.PUZZLES_PER_ROUND
): DifficultyProfile => {
    const progress = rampProgress(puzzleIndex, puzzleCount);
    const maxFootprintSide = Math.round(
        lerp(1, CUBE_COUNTER.MAX_FOOTPRINT_SIDE, progress)
    );

    return {
        boxCount: Math.round(
            lerp(CUBE_COUNTER.EASIEST_BOX_COUNT, CUBE_COUNTER.HARDEST_BOX_COUNT, progress)
        ),
        maxFootprintSide,
        bigBoxChance:
            maxFootprintSide > 1
                ? lerp(
                      CUBE_COUNTER.EASIEST_BIG_BOX_CHANCE,
                      CUBE_COUNTER.HARDEST_BIG_BOX_CHANCE,
                      progress
                  )
                : 0,
        maxStackLevels: Math.round(lerp(1, CUBE_COUNTER.MAX_LEVELS, progress)),
        flashMs: CUBE_COUNTER.FLASH_MS
    };
};
