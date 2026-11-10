/**
 * Validation of untrusted client messages. Anything malformed returns null and
 * is dropped by the runner; nothing here throws.
 */

import { MAX_RACE_MS, TYPE_RACER } from './constants';
import { totalCharacters } from './progress';
import type { RollAction, TypeRacerResult, TypeRacerRound, TypingEvent } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const parseTimestamp = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const rounded = Math.round(raw);
    return rounded >= 0 && rounded <= MAX_RACE_MS ? rounded : null;
};

const parseEvent = (raw: unknown): TypingEvent | null => {
    if (!isRecord(raw)) return null;
    if (raw.kind !== 'mistake' && raw.kind !== 'line') return null;
    const atMs = parseTimestamp(raw.atMs);
    return atMs === null ? null : { kind: raw.kind, atMs };
};

export const parseTypeRacerResult = (raw: unknown): TypeRacerResult | null => {
    if (!isRecord(raw) || !Array.isArray(raw.events)) return null;
    if (raw.events.length > TYPE_RACER.MAX_EVENTS) return null;

    const events: TypingEvent[] = [];
    for (const rawEvent of raw.events) {
        const event = parseEvent(rawEvent);
        if (event === null) return null;

        // Things happen in order; a time that goes backwards is a bad report.
        const previous = events[events.length - 1];
        if (previous !== undefined && event.atMs < previous.atMs) return null;
        events.push(event);
    }

    const endedAtMs = parseTimestamp(raw.endedAtMs);
    const lastEventAtMs = events[events.length - 1]?.atMs ?? 0;
    if (endedAtMs === null || endedAtMs < lastEventAtMs) return null;

    return { events, endedAtMs, timingSuspect: raw.timingSuspect === true };
};

/**
 * Progress is display-only: where the player is on the shared bar and how
 * close to danger, so opponents can watch. The server never uses it to decide
 * anything.
 *   chars:     correct characters typed so far in the whole race;
 *   paragraph: the section (paragraph) the player is in, 0-based;
 *   strikes, skulls: danger markers;
 *   status:    0 = typing, 1 = finished, 2 = out.
 */
export const parseTypeRacerProgress = (
    raw: unknown,
    round: TypeRacerRound
): Record<string, number> | null => {
    if (!isRecord(raw)) return null;

    const bounds = {
        chars: totalCharacters(round.paragraphs),
        paragraph: round.paragraphs.length,
        strikes: TYPE_RACER.STRIKES_TO_ROLL,
        skulls: TYPE_RACER.MAX_SKULLS,
        status: 2
    } as const;

    const progress: Record<string, number> = {};
    for (const [key, max] of Object.entries(bounds)) {
        const value = raw[key];
        if (typeof value !== 'number' || !Number.isInteger(value)) return null;
        if (value < 0 || value > max) return null;
        progress[key] = value;
    }
    return progress;
};

/** The mid-race request to cast the dice. */
export const parseRollAction = (raw: unknown): RollAction | null => {
    if (!isRecord(raw) || raw.type !== 'roll') return null;
    const { rollIndex } = raw;
    if (typeof rollIndex !== 'number' || !Number.isInteger(rollIndex)) return null;
    return rollIndex >= 0 && rollIndex <= TYPE_RACER.MAX_ROLL_INDEX
        ? { type: 'roll', rollIndex }
        : null;
};
