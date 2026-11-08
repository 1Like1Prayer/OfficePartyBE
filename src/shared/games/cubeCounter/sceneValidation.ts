import { findStructureProblem } from './geometry';
import { findVisibilityProblem } from './visibility';
import type { Box } from './types';

/**
 * Every rule a scene must satisfy before it can be sent to players:
 * structurally sound, and readable from the fixed camera.
 * Returns the first problem found, or null for a valid scene.
 */
export const findSceneProblem = (boxes: readonly Box[]): string | null =>
    findStructureProblem(boxes) ?? findVisibilityProblem(boxes);

/** The correct answer to a puzzle: big blocks count once. */
export const countBlocks = (boxes: readonly Box[]): number => boxes.length;
