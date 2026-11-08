import type { Box, Cell } from './types';

export const footprintCells = (box: Box): Cell[] => {
    const cells: Cell[] = [];
    for (let dx = 0; dx < box.width; dx++) {
        for (let dy = 0; dy < box.depth; dy++) {
            cells.push({ x: box.x + dx, y: box.y + dy });
        }
    }
    return cells;
};

export const isBigBox = (box: Box): boolean => box.width > 1 || box.depth > 1;
