/**
 * Pure box geometry and the structural rules of a scene: inside the grid, no
 * overlaps, nothing floating. Whether a scene is *readable* from the camera
 * is a separate question, answered in visibility.ts.
 */

import { CUBE_COUNTER } from './constants';
import { footprintCells } from './footprint';
import { buildOccupancy } from './occupancy';
import type { Box } from './types';

const { GRID_SIZE, MAX_LEVELS, MAX_FOOTPRINT_SIDE } = CUBE_COUNTER;

const isWholeNumber = (value: number): boolean => Number.isInteger(value);

const hasValidShape = (box: Box): boolean =>
    [box.x, box.y, box.z, box.width, box.depth].every(isWholeNumber) &&
    box.width >= 1 &&
    box.depth >= 1 &&
    box.width <= MAX_FOOTPRINT_SIDE &&
    box.depth <= MAX_FOOTPRINT_SIDE;

const isInsideGrid = (box: Box): boolean =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.z >= 0 &&
    box.x + box.width <= GRID_SIZE &&
    box.y + box.depth <= GRID_SIZE &&
    box.z < MAX_LEVELS;

/**
 * Returns why a scene is structurally invalid, or null when it is fine.
 * The reason is for tests and debugging; nothing shows it to a player.
 */
export const findStructureProblem = (boxes: readonly Box[]): string | null => {
    for (const box of boxes) {
        if (!hasValidShape(box)) return `bad box shape: ${JSON.stringify(box)}`;
        if (!isInsideGrid(box)) return `box outside grid: ${JSON.stringify(box)}`;
    }

    const occupancy = buildOccupancy(boxes);
    if (occupancy === null) return 'two boxes overlap';

    for (const box of boxes) {
        if (box.z === 0) continue;
        const isSupported = footprintCells(box).every(
            (cell) => occupancy.boxIdAt(cell.x, cell.y, box.z - 1) !== null
        );
        if (!isSupported) return `floating box: ${JSON.stringify(box)}`;
    }

    return null;
};
