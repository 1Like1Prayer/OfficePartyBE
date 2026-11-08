/**
 * Can the player actually see each box from the fixed camera?
 *
 * The camera looks along (-1, -1, -1), i.e. from the high-x, high-y, high-z
 * corner, so each box shows three faces: its top, its +x side and its +y
 * side. To measure how much of a box is showing, we place sample points on
 * those faces and cast a ray from each one toward the camera. A sample is
 * visible if the ray leaves the scene without crossing another box.
 *
 * The rules this enforces (the point of the game's fairness):
 *  - a big box (footprint larger than 1x1) has its whole top uncovered and
 *    most of its surface showing, so it can never be buried or tucked behind
 *    a tower;
 *  - a single cube still shows enough of itself to be counted.
 */

import { CUBE_COUNTER } from './constants';
import { footprintCells, isBigBox } from './footprint';
import { buildOccupancy, type Occupancy } from './occupancy';
import type { Box } from './types';

const { GRID_SIZE, MAX_LEVELS } = CUBE_COUNTER;

interface Point3 {
    x: number;
    y: number;
    z: number;
}

/** Offsets within a face: a 2x2 spread that avoids the edges. */
const SAMPLE_OFFSETS = [0.25, 0.75] as const;
/** Moves a sample just off its surface so it doesn't start inside its own box. */
const SURFACE_NUDGE = 1e-4;
const RAY_STEP = 0.05;

export interface BoxVisibility {
    /** Fraction of the top face that is visible, 0..1. */
    top: number;
    /** Fraction of the top, +x and +y faces together that is visible, 0..1. */
    overall: number;
}

const fractionVisible = (samples: boolean[]): number =>
    samples.length === 0 ? 0 : samples.filter(Boolean).length / samples.length;

/** Walks from a point toward the camera; true if nothing blocks the way. */
const hasClearLineToCamera = (start: Point3, occupancy: Occupancy): boolean => {
    let { x, y, z } = start;
    x += SURFACE_NUDGE;
    y += SURFACE_NUDGE;
    z += SURFACE_NUDGE;

    while (x < GRID_SIZE && y < GRID_SIZE && z < MAX_LEVELS) {
        if (occupancy.boxIdAt(Math.floor(x), Math.floor(y), Math.floor(z)) !== null) {
            return false;
        }
        x += RAY_STEP;
        y += RAY_STEP;
        z += RAY_STEP;
    }
    return true;
};

const topFaceSamples = (box: Box): Point3[] =>
    footprintCells(box).flatMap((cell) =>
        SAMPLE_OFFSETS.flatMap((u) =>
            SAMPLE_OFFSETS.map((v) => ({ x: cell.x + u, y: cell.y + v, z: box.z + 1 }))
        )
    );

/** The face looking toward +x: one column of samples per row of the footprint. */
const sideXFaceSamples = (box: Box): Point3[] =>
    Array.from({ length: box.depth }, (_, row) => box.y + row).flatMap((y) =>
        SAMPLE_OFFSETS.flatMap((u) =>
            SAMPLE_OFFSETS.map((v) => ({ x: box.x + box.width, y: y + u, z: box.z + v }))
        )
    );

/** The face looking toward +y. */
const sideYFaceSamples = (box: Box): Point3[] =>
    Array.from({ length: box.width }, (_, column) => box.x + column).flatMap((x) =>
        SAMPLE_OFFSETS.flatMap((u) =>
            SAMPLE_OFFSETS.map((v) => ({ x: x + u, y: box.y + box.depth, z: box.z + v }))
        )
    );

export const measureBoxVisibility = (
    box: Box,
    occupancy: Occupancy
): BoxVisibility => {
    const isVisible = (point: Point3): boolean =>
        hasClearLineToCamera(point, occupancy);

    const top = topFaceSamples(box).map(isVisible);
    const sides = [...sideXFaceSamples(box), ...sideYFaceSamples(box)].map(isVisible);

    return {
        top: fractionVisible(top),
        overall: fractionVisible([...top, ...sides])
    };
};

const isReadable = (visibility: BoxVisibility, box: Box): boolean =>
    isBigBox(box)
        ? visibility.top === 1 &&
          visibility.overall >= CUBE_COUNTER.MIN_BIG_BOX_VISIBLE_FRACTION
        : visibility.overall >= CUBE_COUNTER.MIN_SINGLE_BOX_VISIBLE_FRACTION;

/** Returns why a scene can't be read from the camera, or null when it can. */
export const findVisibilityProblem = (boxes: readonly Box[]): string | null => {
    const occupancy = buildOccupancy(boxes);
    if (occupancy === null) return 'boxes overlap';

    for (const box of boxes) {
        if (!isReadable(measureBoxVisibility(box, occupancy), box)) {
            return `box not readable from camera: ${JSON.stringify(box)}`;
        }
    }
    return null;
};
