/**
 * Lays out a minefield. Mines are scattered across the field, thin near the
 * start and thick near the finish, then the field is checked for a route
 * through: it must be possible to get across without setting anything off,
 * even if hard to find without scanning.
 */

import type { RandomSource } from '../random';
import { MINEFIELD } from './constants';
import type { Mine, MinefieldMap } from './types';

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const mineZone = (): { from: number; to: number } => ({
    from: MINEFIELD.START_SAFE_TILES,
    to: MINEFIELD.FINISH_X - MINEFIELD.FINISH_SAFE_TILES
});

/** Mines per tile at column x. */
export const densityAt = (x: number): number => {
    const { from, to } = mineZone();
    const progress = Math.min(Math.max((x - from) / (to - from), 0), 1);
    return lerp(MINEFIELD.EASIEST_DENSITY, MINEFIELD.HARDEST_DENSITY, progress);
};

/** How many mines the field would have at full strength. */
const targetMineCount = (): number => {
    const { from, to } = mineZone();
    let total = 0;
    for (let column = from; column < to; column++) {
        total += densityAt(column + 0.5) * MINEFIELD.HEIGHT;
    }
    return Math.round(total);
};

const layMines = (count: number, random: RandomSource): Mine[] => {
    const { from, to } = mineZone();
    const mines: Mine[] = [];
    const minSpacingSquared = MINEFIELD.MIN_MINE_SPACING ** 2;

    for (let tries = 0; mines.length < count && tries < count * 40; tries++) {
        const x = from + random() * (to - from);
        // Thicker towards the finish: accept a spot in proportion to its density.
        if (random() >= densityAt(x) / MINEFIELD.HARDEST_DENSITY) continue;
        const y = 0.5 + random() * (MINEFIELD.HEIGHT - 1);
        if (mines.some((mine) => (mine.x - x) ** 2 + (mine.y - y) ** 2 < minSpacingSquared)) {
            continue;
        }
        mines.push({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    }
    return mines;
};

/**
 * Is there a route from the start to the finish line that stays outside every
 * mine's trigger radius (plus a little clearance)? A search over a fine grid.
 */
export const hasSafeRoute = (map: MinefieldMap): boolean => {
    const resolution = MINEFIELD.SAFE_PATH_GRID;
    const columns = Math.floor(map.width / resolution);
    const rows = Math.floor(map.height / resolution);
    const clearance = MINEFIELD.TRIGGER_RADIUS + MINEFIELD.PATH_CLEARANCE;

    const blocked = new Uint8Array(columns * rows);
    for (const mine of map.mines) {
        const reach = Math.ceil(clearance / resolution);
        const centreColumn = Math.floor(mine.x / resolution);
        const centreRow = Math.floor(mine.y / resolution);
        for (let row = centreRow - reach; row <= centreRow + reach; row++) {
            for (let column = centreColumn - reach; column <= centreColumn + reach; column++) {
                if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
                const cellX = (column + 0.5) * resolution;
                const cellY = (row + 0.5) * resolution;
                if ((cellX - mine.x) ** 2 + (cellY - mine.y) ** 2 <= clearance ** 2) {
                    blocked[row * columns + column] = 1;
                }
            }
        }
    }

    const startColumn = Math.floor(map.startX / resolution);
    const startRow = Math.floor(map.startY / resolution);
    if (blocked[startRow * columns + startColumn]) return false;

    const finishColumn = Math.ceil(map.finishX / resolution);
    const seen = new Uint8Array(columns * rows);
    const queue: number[] = [startRow * columns + startColumn];
    seen[queue[0]!] = 1;

    for (let head = 0; head < queue.length; head++) {
        const cell = queue[head]!;
        const column = cell % columns;
        const row = Math.floor(cell / columns);
        if (column >= finishColumn) return true;

        for (let dRow = -1; dRow <= 1; dRow++) {
            for (let dColumn = -1; dColumn <= 1; dColumn++) {
                const nextColumn = column + dColumn;
                const nextRow = row + dRow;
                if (nextColumn < 0 || nextRow < 0 || nextColumn >= columns || nextRow >= rows) {
                    continue;
                }
                const next = nextRow * columns + nextColumn;
                if (seen[next] || blocked[next]) continue;
                seen[next] = 1;
                queue.push(next);
            }
        }
    }
    return false;
};

const emptyMap = (mines: Mine[]): MinefieldMap => ({
    width: MINEFIELD.WIDTH,
    height: MINEFIELD.HEIGHT,
    startX: MINEFIELD.START_X,
    startY: MINEFIELD.START_Y,
    finishX: MINEFIELD.FINISH_X,
    mines
});

export const generateMap = (random: RandomSource = Math.random): MinefieldMap => {
    let count = targetMineCount();
    for (let attempt = 0; attempt < MINEFIELD.MAX_GENERATION_ATTEMPTS; attempt++) {
        const map = emptyMap(layMines(count, random));
        if (hasSafeRoute(map)) return map;
        // Too dense to cross: lay a thinner field next time.
        count = Math.max(0, Math.floor(count * 0.9));
    }
    return emptyMap([]);
};
