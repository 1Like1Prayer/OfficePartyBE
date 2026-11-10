/**
 * Where the dice get their randomness.
 *
 * Each roll is derived from a secret that never leaves the server, the
 * round's public nonce, the player and the roll number. That makes a roll
 * unpredictable to the browser, yet reproducible by the server: it can answer
 * "what did I roll?" mid-race and later replay the race with the same dice,
 * without storing anything per player.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { TYPE_RACER } from '../shared/games/typeRacer/constants';
import type { RollFace } from '../shared/games/typeRacer/types';

/** Fresh every time the server starts; a round never outlives a restart. */
const ROLL_SECRET = randomBytes(32);

export const hmacRollFace: RollFace = (nonce, playerId, rollIndex) => {
    const digest = createHmac('sha256', ROLL_SECRET)
        .update(`${nonce}:${playerId}:${rollIndex}`)
        .digest();
    return (digest.readUInt32BE(0) % TYPE_RACER.DICE_SIDES) + 1;
};
