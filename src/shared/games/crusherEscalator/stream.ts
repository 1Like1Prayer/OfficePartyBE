/**
 * Arrow streams.
 *
 * A stream is a short list of directions that loops forever, and it advances
 * on every key press (right or wrong). Rules:
 *  - never the same direction twice in a row, including across the loop point;
 *  - every player gets a different stream.
 */

import { randomInt, type RandomSource } from '../random';
import { CRUSHER_ESCALATOR, DIRECTIONS } from './constants';
import type { ArrowStream, Direction } from './types';

/** Picks any direction except the ones listed. Always possible: there are four. */
const pickDirectionExcluding = (
    random: RandomSource,
    excluded: readonly Direction[]
): Direction => {
    const allowed = DIRECTIONS.filter((direction) => !excluded.includes(direction));
    return allowed[randomInt(random, 0, allowed.length - 1)]!;
};

export const generateStream = (
    random: RandomSource,
    length: number = CRUSHER_ESCALATOR.STREAM_LENGTH
): Direction[] => {
    const stream: Direction[] = [];

    for (let index = 0; index < length; index++) {
        const previous = stream[index - 1];
        const isLast = index === length - 1;
        // The last symbol is followed by the first when the stream loops.
        const first = stream[0];

        const excluded: Direction[] = [];
        if (previous !== undefined) excluded.push(previous);
        if (isLast && first !== undefined) excluded.push(first);

        stream.push(pickDirectionExcluding(random, excluded));
    }
    return stream;
};

const streamKey = (stream: ArrowStream): string => stream.join(',');

/** One stream per player, no two alike. */
export const generatePlayerStreams = (
    playerIds: readonly string[],
    random: RandomSource
): Record<string, Direction[]> => {
    const streams: Record<string, Direction[]> = {};
    const used = new Set<string>();

    for (const playerId of playerIds) {
        let stream = generateStream(random);
        while (used.has(streamKey(stream))) stream = generateStream(random);

        used.add(streamKey(stream));
        streams[playerId] = stream;
    }
    return streams;
};

/** The arrow showing after `pressCount` presses. Loops past the end. */
export const directionAt = (stream: ArrowStream, pressCount: number): Direction =>
    stream[pressCount % stream.length]!;
