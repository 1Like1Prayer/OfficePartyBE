/**
 * A lookup from a grid voxel to the box filling it. Used by the generator's
 * overlap check and by the visibility ray casts.
 */

import { CUBE_COUNTER } from './constants';
import { footprintCells } from './footprint';
import type { Box } from './types';

const { GRID_SIZE, MAX_LEVELS } = CUBE_COUNTER;

export interface Occupancy {
    /** Index into the box list of the box at this voxel, or null if empty. */
    boxIdAt(x: number, y: number, z: number): number | null;
}

const isInsideVolume = (x: number, y: number, z: number): boolean =>
    x >= 0 && y >= 0 && z >= 0 && x < GRID_SIZE && y < GRID_SIZE && z < MAX_LEVELS;

const voxelIndex = (x: number, y: number, z: number): number =>
    (z * GRID_SIZE + y) * GRID_SIZE + x;

/**
 * Returns null when two boxes claim the same voxel (or a box is out of the
 * volume), so overlap detection and lookup come from one pass.
 */
export const buildOccupancy = (boxes: readonly Box[]): Occupancy | null => {
    const voxels: (number | null)[] = new Array(
        GRID_SIZE * GRID_SIZE * MAX_LEVELS
    ).fill(null);

    for (const [boxId, box] of boxes.entries()) {
        for (const cell of footprintCells(box)) {
            if (!isInsideVolume(cell.x, cell.y, box.z)) return null;
            const index = voxelIndex(cell.x, cell.y, box.z);
            if (voxels[index] !== null) return null;
            voxels[index] = boxId;
        }
    }

    return {
        boxIdAt: (x, y, z) =>
            isInsideVolume(x, y, z) ? (voxels[voxelIndex(x, y, z)] ?? null) : null
    };
};
