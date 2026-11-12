/**
 * Builds the log schedule for a round. It ramps up until HARD_FROM_MS, then
 * stays hard: logs arrive closer together (never under MIN_GAP_MS), move at
 * different speeds (the same spread all round), and come in from wider angles.
 */

import { randomInt, type RandomSource } from '../random';
import { LOG_DODGE, LOG_HEIGHTS } from './constants';
import type { Log } from './types';

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

const between = (random: RandomSource, [min, max]: readonly [number, number]): number =>
    min + random() * (max - min);

export const generateLogs = (
    random: RandomSource,
    durationMs: number = LOG_DODGE.DURATION_MS
): Log[] => {
    const logs: Log[] = [];
    // Every log must be fully resolved (its window closed) inside the round.
    const lastArrival = durationMs - LOG_DODGE.HIT_WINDOW_MS;
    let arriveAtMs = LOG_DODGE.FIRST_ARRIVAL_MS;

    while (arriveAtMs <= lastArrival) {
        const progress = Math.min(
            1,
            (arriveAtMs - LOG_DODGE.FIRST_ARRIVAL_MS) /
                (LOG_DODGE.HARD_FROM_MS - LOG_DODGE.FIRST_ARRIVAL_MS)
        );

        const travelMs = Math.round(between(random, LOG_DODGE.TRAVEL_RANGE_MS));

        const angleRange = lerp(LOG_DODGE.START_ANGLE_RANGE_DEG, LOG_DODGE.HARD_ANGLE_RANGE_DEG, progress);

        logs.push({
            height: LOG_HEIGHTS[randomInt(random, 0, LOG_HEIGHTS.length - 1)]!,
            arriveAtMs: Math.round(arriveAtMs),
            travelMs,
            angleDeg: Math.round(between(random, [-angleRange, angleRange]))
        });

        const gap = lerp(LOG_DODGE.START_GAP_MS, LOG_DODGE.HARD_GAP_MS, progress);
        const jitter = 1 + (random() * 2 - 1) * LOG_DODGE.GAP_JITTER;
        arriveAtMs += Math.max(LOG_DODGE.MIN_GAP_MS, gap * jitter);
    }
    return logs;
};
