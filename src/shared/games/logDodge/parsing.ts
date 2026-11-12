/**
 * Validation of untrusted client messages. Anything malformed returns null and
 * is dropped by the runner; nothing here throws.
 */

import { ACTIONS, LOG_DODGE } from './constants';
import type { Action, Input, LogDodgeResult } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const isAction = (value: unknown): value is Action =>
    typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);

const parseInput = (raw: unknown, durationMs: number): Input | null => {
    if (!isRecord(raw)) return null;
    const { action, atMs } = raw;
    if (!isAction(action)) return null;
    if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return null;

    const rounded = Math.round(atMs);
    return rounded >= 0 && rounded <= durationMs ? { action, atMs: rounded } : null;
};

export const parseLogDodgeResult = (
    raw: unknown,
    durationMs: number = LOG_DODGE.DURATION_MS
): LogDodgeResult | null => {
    if (!isRecord(raw) || !Array.isArray(raw.inputs)) return null;
    if (raw.inputs.length > LOG_DODGE.MAX_INPUTS) return null;

    const inputs: Input[] = [];
    for (const rawInput of raw.inputs) {
        const input = parseInput(rawInput, durationMs);
        if (input === null) return null;

        // Presses happen in order; a time that goes backwards is a bad report.
        const previous = inputs[inputs.length - 1];
        if (previous !== undefined && input.atMs < previous.atMs) return null;
        inputs.push(input);
    }
    return { inputs, timingSuspect: raw.timingSuspect === true };
};

/**
 * Progress is display-only: the player's hit count, so opponents can see who
 * is on the ropes. The server never uses it to decide anything.
 */
export const parseLogDodgeProgress = (raw: unknown): Record<string, number> | null => {
    if (!isRecord(raw)) return null;
    const { hits } = raw;
    if (typeof hits !== 'number' || !Number.isInteger(hits)) return null;
    return hits >= 0 && hits <= LOG_DODGE.MAX_HITS ? { hits } : null;
};
