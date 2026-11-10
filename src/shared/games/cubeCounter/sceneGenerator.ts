/**
 * Builds a random scene for a difficulty level.
 *
 * Boxes are dropped one at a time onto the grid, each resting on the floor or
 * on a perfectly flat patch of earlier boxes. The finished scene is then run
 * through findSceneProblem; unreadable scenes (a big block buried behind a
 * tower, say) are thrown away and regenerated.
 */

import { randomInt, type RandomSource } from '../random';
import { CUBE_COUNTER } from './constants';
import type { DifficultyProfile } from './difficulty';
import { difficultyForPuzzle } from './difficulty';
import { footprintCells } from './footprint';
import { findSceneProblem } from './sceneValidation';
import type { Box, Puzzle } from './types';

const { GRID_SIZE } = CUBE_COUNTER;

/** A scene that always satisfies every rule; the last resort for a one-box request. */
const FALLBACK_BOXES: readonly Box[] = [
    { x: 0, y: 0, z: 0, width: 1, depth: 1 },
    { x: 2, y: 0, z: 0, width: 1, depth: 1 },
    { x: 4, y: 0, z: 0, width: 1, depth: 1 }
];

const pickFootprint = (
    profile: DifficultyProfile,
    random: RandomSource
): { width: number; depth: number } => {
    if (random() >= profile.bigBoxChance) return { width: 1, depth: 1 };

    // Re-roll until the footprint is actually bigger than 1x1.
    for (;;) {
        const width = randomInt(random, 1, profile.maxFootprintSide);
        const depth = randomInt(random, 1, profile.maxFootprintSide);
        if (width > 1 || depth > 1) return { width, depth };
    }
};

/** How many levels are already stacked on each floor cell. */
type ColumnHeights = number[][];

const emptyColumnHeights = (): ColumnHeights =>
    Array.from({ length: GRID_SIZE }, () => new Array<number>(GRID_SIZE).fill(0));

/**
 * The level a box could rest on at this spot, or null if the ground under its
 * footprint is uneven or already stacked to the limit.
 */
const restingLevel = (
    heights: ColumnHeights,
    box: Omit<Box, 'z'>,
    maxStackLevels: number
): number | null => {
    const levels = footprintCells({ ...box, z: 0 }).map(
        (cell) => heights[cell.x]![cell.y]!
    );
    const level = levels[0]!;
    const isFlat = levels.every((other) => other === level);
    return isFlat && level < maxStackLevels ? level : null;
};

const tryPlaceBox = (
    heights: ColumnHeights,
    profile: DifficultyProfile,
    random: RandomSource
): Box | null => {
    for (let attempt = 0; attempt < CUBE_COUNTER.MAX_PLACEMENT_TRIES_PER_BOX; attempt++) {
        const { width, depth } = pickFootprint(profile, random);
        const x = randomInt(random, 0, GRID_SIZE - width);
        const y = randomInt(random, 0, GRID_SIZE - depth);
        const z = restingLevel(heights, { x, y, width, depth }, profile.maxStackLevels);
        if (z !== null) return { x, y, z, width, depth };
    }
    return null;
};

const dropBoxes = (profile: DifficultyProfile, random: RandomSource): Box[] => {
    const heights = emptyColumnHeights();
    const boxes: Box[] = [];

    while (boxes.length < profile.boxCount) {
        const box = tryPlaceBox(heights, profile, random);
        if (box === null) break; // No room left; settle for fewer boxes.

        boxes.push(box);
        for (const cell of footprintCells(box)) {
            heights[cell.x]![cell.y] = box.z + 1;
        }
    }
    return boxes;
};

export const generateScene = (
    profile: DifficultyProfile,
    random: RandomSource = Math.random
): Box[] => {
    for (let attempt = 0; attempt < CUBE_COUNTER.MAX_SCENE_ATTEMPTS; attempt++) {
        const boxes = dropBoxes(profile, random);
        if (boxes.length > 0 && findSceneProblem(boxes) === null) return boxes;
    }

    // Too crowded to arrange readably: ask for one fewer box rather than fail.
    if (profile.boxCount > 1) {
        return generateScene({ ...profile, boxCount: profile.boxCount - 1 }, random);
    }
    return FALLBACK_BOXES.map((box) => ({ ...box }));
};

/** The full set of puzzles for one scoring round, easiest first. */
export const generatePuzzles = (
    random: RandomSource = Math.random,
    puzzleCount: number = CUBE_COUNTER.PUZZLES_PER_ROUND
): Puzzle[] =>
    Array.from({ length: puzzleCount }, (_, puzzleIndex) => {
        const profile = difficultyForPuzzle(puzzleIndex, puzzleCount);
        return { boxes: generateScene(profile, random), flashMs: profile.flashMs };
    });
