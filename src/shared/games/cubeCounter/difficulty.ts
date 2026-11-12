/**
 * How hard each puzzle in a round is. The ramp runs from the first puzzle to
 * the last and restarts every round, so round 2 begins easy again.
 */

import { randomInt, type RandomSource } from '../random';
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
    /**
     * Chance that a box is built on top of others rather than on the floor.
     * Higher means taller, layered scenes; lower means a sprawl of boxes.
     */
    stackBias: number;
    flashMs: number;
}

/**
 * How a hard scene is built, so two scenes with the same number of boxes can
 * look nothing alike:
 *  - layered: stacked in layers with many big blocks, which makes the count
 *    hard to judge because a big block counts once;
 *  - sprawl: lots of single cubes spread over the floor;
 *  - mixed: a bit of everything.
 */
export type SceneStyle = 'layered' | 'sprawl' | 'mixed';
const SCENE_STYLES: readonly SceneStyle[] = ['layered', 'sprawl', 'mixed'];

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
        stackBias: 0.35,
        flashMs: CUBE_COUNTER.FLASH_MS
    };
};

/** Applies a construction style on top of a hard puzzle's baseline profile. */
const withStyle = (profile: DifficultyProfile, style: SceneStyle): DifficultyProfile => {
    switch (style) {
        case 'layered':
            return {
                ...profile,
                maxFootprintSide: CUBE_COUNTER.MAX_FOOTPRINT_SIDE,
                bigBoxChance: CUBE_COUNTER.HARDEST_BIG_BOX_CHANCE + 0.1,
                maxStackLevels: CUBE_COUNTER.MAX_LEVELS,
                stackBias: 0.85
            };
        case 'sprawl':
            return { ...profile, bigBoxChance: 0.1, stackBias: 0.05 };
        case 'mixed':
            return profile;
    }
};

/**
 * The difficulty of every puzzle in a round.
 *
 * The easy start climbs steadily so players can warm up. From the hard end
 * of the ramp the box counts stop climbing: each hard puzzle gets a random
 * count from HARD_BOX_COUNT_MIN to HARDEST_BOX_COUNT, so it can fall back or
 * repeat by chance, and a random construction style, so how big a scene looks
 * says little about how many boxes it holds.
 */
export const planDifficulty = (
    puzzleCount: number = CUBE_COUNTER.PUZZLES_PER_ROUND,
    random: RandomSource = Math.random
): DifficultyProfile[] =>
    Array.from({ length: puzzleCount }, (_, index) => {
        const baseline = difficultyForPuzzle(index, puzzleCount);
        if (rampProgress(index, puzzleCount) < CUBE_COUNTER.HARD_FROM_PROGRESS) {
            return baseline;
        }

        const boxCount = randomInt(
            random,
            CUBE_COUNTER.HARD_BOX_COUNT_MIN,
            CUBE_COUNTER.HARDEST_BOX_COUNT
        );
        const style = SCENE_STYLES[randomInt(random, 0, SCENE_STYLES.length - 1)]!;
        return withStyle({ ...baseline, boxCount }, style);
    });
