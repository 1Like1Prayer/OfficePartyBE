/**
 * Splitting a crowd into heats.
 */

import { shuffled, type RandomSource } from '../random';

/**
 * Two groups as even as possible, assigned at random: 7 players become 4 + 3,
 * 8 become 4 + 4, 11 become 6 + 5.
 */
export const splitIntoTwoGroups = (
    playerIds: readonly string[],
    random: RandomSource
): [string[], string[]] => {
    const mixed = shuffled(playerIds, random);
    const firstGroupSize = Math.ceil(mixed.length / 2);
    return [mixed.slice(0, firstGroupSize), mixed.slice(firstGroupSize)];
};
