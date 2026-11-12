/**
 * Validation of untrusted client messages. Anything malformed returns null and
 * is dropped by the runner; nothing here throws.
 */

import { MINEFIELD } from './constants';
import type { Axis, Input, MinefieldResult } from './types';

/** More scans than a race could ever hold (one per cooldown, with room to spare). */
const MAX_SCANS = Math.ceil(MINEFIELD.MAX_RACE_MS / MINEFIELD.SONAR_COOLDOWN_MS) + 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const isAxis = (value: unknown): value is Axis =>
    value === -1 || value === 0 || value === 1;

const parseInput = (raw: unknown): Input | null => {
    if (!isRecord(raw)) return null;
    const { kind, atMs } = raw;
    if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;
    const rounded = Math.round(atMs);
    if (rounded < 0 || rounded > MINEFIELD.MAX_RACE_MS) return null;

    if (kind === 'sonar') return { kind, atMs: rounded };
    if (kind === 'move' && isAxis(raw.dx) && isAxis(raw.dy)) {
        return { kind, atMs: rounded, dx: raw.dx, dy: raw.dy };
    }
    return null;
};

export const parseMinefieldResult = (raw: unknown): MinefieldResult | null => {
    if (!isRecord(raw) || !Array.isArray(raw.inputs)) return null;
    if (raw.inputs.length > MINEFIELD.MAX_INPUTS) return null;

    const inputs: Input[] = [];
    for (const rawInput of raw.inputs) {
        const input = parseInput(rawInput);
        if (input === null) return null;

        // Things happen in order; a time that goes backwards is a bad report.
        const previous = inputs[inputs.length - 1];
        if (previous !== undefined && input.atMs < previous.atMs) return null;
        inputs.push(input);
    }
    return { inputs, timingSuspect: raw.timingSuspect === true };
};

/**
 * Progress is display-only, so opponents can watch the race:
 *   x:      how far along the field, in tenths of a tile;
 *   lives:  lives left;
 *   status: 0 = racing, 1 = finished, 2 = out;
 *   mine:   the most recent mine that hurt this player, as its index in the
 *           field plus one (0 for none). Other players' screens use it to take
 *           that mine off the field, since it is gone for them too;
 *   scans, scanX, scanY: how many sonar scans this player has made, and where
 *           they stood (in tenths of a tile) for the latest. Other players'
 *           screens show what that scan found, since sonar is shared: when
 *           `scans` goes up, reveal the mines in range of (scanX, scanY).
 * The server never uses it to decide anything.
 */
export const parseMinefieldProgress = (
    raw: unknown,
    mineCount: number = MINEFIELD.WIDTH * MINEFIELD.HEIGHT
): Record<string, number> | null => {
    if (!isRecord(raw)) return null;

    const required = {
        x: MINEFIELD.WIDTH * 10,
        lives: MINEFIELD.LIVES,
        status: 2
    } as const;
    // Optional so a client that doesn't send them yet still shows its position.
    const optional = {
        mine: mineCount,
        scans: MAX_SCANS,
        scanX: MINEFIELD.WIDTH * 10,
        scanY: MINEFIELD.HEIGHT * 10
    } as const;

    const progress: Record<string, number> = {};
    for (const [bounds, isRequired] of [[required, true], [optional, false]] as const) {
        for (const [key, max] of Object.entries(bounds)) {
            const value = raw[key];
            if (value === undefined && !isRequired) {
                progress[key] = 0;
                continue;
            }
            if (typeof value !== 'number' || !Number.isInteger(value)) return null;
            if (value < 0 || value > max) return null;
            progress[key] = value;
        }
    }
    return progress;
};
