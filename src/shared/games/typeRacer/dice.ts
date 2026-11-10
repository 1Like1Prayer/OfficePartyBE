/**
 * The roulette dice. A six-sided die with hearts and skulls: land on a skull
 * and you are out. The first roll has one skull side; every roll a player
 * survives adds another, and the count never resets during a race.
 */

import { TYPE_RACER } from './constants';
import type { DieRoll } from './types';

/** How many sides are skulls on a player's `rollIndex`-th roll (0-based). */
export const skullsForRoll = (rollIndex: number): number =>
    Math.min(TYPE_RACER.STARTING_SKULLS + rollIndex, TYPE_RACER.MAX_SKULLS);

/** Skull sides are the lowest faces: with 2 skulls, faces 1 and 2 are skulls. */
export const isSkull = (face: number, rollIndex: number): boolean =>
    face <= skullsForRoll(rollIndex);

export const describeRoll = (face: number, rollIndex: number): DieRoll => ({
    face,
    skulls: skullsForRoll(rollIndex),
    isSkull: isSkull(face, rollIndex)
});
