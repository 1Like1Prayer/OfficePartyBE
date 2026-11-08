/**
 * Validation of untrusted client messages. Anything malformed returns null and
 * is dropped by the runner; nothing here throws.
 */

import { CUBE_COUNTER, MAX_POSSIBLE_BOX_COUNT } from './constants';
import type { Answer, CubeCounterResult } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

const parseCount = (raw: unknown): number | null | undefined => {
    if (raw === null) return null;
    if (typeof raw !== 'number' || !Number.isInteger(raw)) return undefined;
    return raw >= 0 && raw <= MAX_POSSIBLE_BOX_COUNT ? raw : undefined;
};

/** Slightly late is honest lag in the client's own timer; clamp instead of rejecting. */
const parseAnswerMs = (raw: unknown): number | null => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const rounded = Math.round(raw);
    return rounded < 0 ? null : Math.min(rounded, CUBE_COUNTER.ANSWER_LIMIT_MS);
};

const parseAnswer = (raw: unknown): Answer | null => {
    if (!isRecord(raw)) return null;
    const count = parseCount(raw.count);
    const answerMs = parseAnswerMs(raw.answerMs);
    return count === undefined || answerMs === null ? null : { count, answerMs };
};

export const parseCubeCounterResult = (
    raw: unknown,
    puzzleCount: number
): CubeCounterResult | null => {
    if (!isRecord(raw) || !Array.isArray(raw.answers)) return null;
    if (raw.answers.length !== puzzleCount) return null;

    const answers: Answer[] = [];
    for (const rawAnswer of raw.answers) {
        const answer = parseAnswer(rawAnswer);
        if (answer === null) return null;
        answers.push(answer);
    }
    return { answers, timingSuspect: raw.timingSuspect === true };
};

/**
 * Progress is display-only: how many puzzles the player has finished. It says
 * nothing about whether they were right.
 */
export const parseCubeCounterProgress = (
    raw: unknown,
    puzzleCount: number
): Record<string, number> | null => {
    if (!isRecord(raw)) return null;
    const { puzzlesDone } = raw;
    if (typeof puzzlesDone !== 'number' || !Number.isInteger(puzzlesDone)) return null;
    if (puzzlesDone < 0 || puzzlesDone > puzzleCount) return null;
    return { puzzlesDone };
};
