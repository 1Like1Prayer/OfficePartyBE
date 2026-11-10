/**
 * Replaying a player's race.
 *
 * The browser types on its own clock and reports what happened (mistakes and
 * finished lines, each timed). The server replays that list against the
 * rules, rolling the dice itself, and works out how the race went. Players
 * never affect each other here, so each run is replayed on its own.
 *
 * Rules:
 *  - a mistake sends the player back to the start of the line and adds a strike;
 *  - the third strike in a paragraph casts the dice. A skull ends the race for
 *    that player. A heart drops them back to two strikes, so one more mistake
 *    casts the dice again, with one more skull side;
 *  - finishing a paragraph resets strikes to 0, but the skull count carries on;
 *  - after each paragraph except the last there is a pause with typing closed,
 *    and the next paragraph's time limit starts when the pause ends;
 *  - each paragraph has a time limit, counted from when typing on it opens;
 *  - finishing the last paragraph finishes the race.
 *
 * Plain functions over plain data: no sockets, no clock, no randomness (the
 * dice come in through `faceOfRoll`).
 */

import { TYPE_RACER } from './constants';
import { isSkull } from './dice';
import type { Paragraph, TypingEvent } from './types';

export type RunStatus = 'finished' | 'eliminated' | 'unfinished';
export type EliminationCause = 'skull' | 'time';

export interface PlayerRun {
    status: RunStatus;
    /** When the run finished or ended, in ms from race start. */
    endedAtMs: number;
    paragraphsDone: number;
    /** Lines completed across all paragraphs. */
    linesDone: number;
    /** Characters in those completed lines. How far the player got. */
    charsDone: number;
    rollsCast: number;
    cause: EliminationCause | null;
}

/** The die's face for the player's `rollIndex`-th roll. */
export type FaceOfRoll = (rollIndex: number) => number;

interface RunState {
    paragraphIndex: number;
    lineIndex: number;
    strikes: number;
    rollsCast: number;
    paragraphStartedAtMs: number;
    linesDone: number;
    charsDone: number;
    end: { status: 'finished' | 'eliminated'; atMs: number; cause: EliminationCause | null } | null;
}

const newRunState = (): RunState => ({
    paragraphIndex: 0,
    lineIndex: 0,
    strikes: 0,
    rollsCast: 0,
    paragraphStartedAtMs: 0,
    linesDone: 0,
    charsDone: 0,
    end: null
});

const paragraphDeadlineMs = (state: RunState): number =>
    state.paragraphStartedAtMs + TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS;

const eliminate = (state: RunState, atMs: number, cause: EliminationCause): void => {
    state.end = { status: 'eliminated', atMs, cause };
};

/** A mistake restarts the line and adds a strike; the third strike casts the dice. */
const applyMistake = (state: RunState, atMs: number, faceOfRoll: FaceOfRoll): void => {
    state.strikes += 1;
    if (state.strikes < TYPE_RACER.STRIKES_TO_ROLL) return;

    const rollIndex = state.rollsCast;
    if (isSkull(faceOfRoll(rollIndex), rollIndex)) {
        eliminate(state, atMs, 'skull');
        return;
    }
    // Survived: back to two strikes, and the next roll has another skull.
    state.rollsCast += 1;
    state.strikes = TYPE_RACER.STRIKES_AFTER_SURVIVING;
};

const applyLineDone = (
    state: RunState,
    atMs: number,
    paragraphs: readonly Paragraph[]
): void => {
    const paragraph = paragraphs[state.paragraphIndex]!;
    state.linesDone += 1;
    state.charsDone += paragraph[state.lineIndex]!.length;
    state.lineIndex += 1;
    if (state.lineIndex < paragraph.length) return;

    // Paragraph finished: strikes reset, skulls do not.
    state.paragraphIndex += 1;
    state.lineIndex = 0;
    state.strikes = 0;
    if (state.paragraphIndex === paragraphs.length) {
        state.end = { status: 'finished', atMs, cause: null };
        return;
    }
    // Pause, then the next paragraph opens and its time limit starts.
    state.paragraphStartedAtMs = atMs + TYPE_RACER.PARAGRAPH_PAUSE_MS;
};

/**
 * @param events     what the client reported, in order
 * @param endedAtMs  when the client stopped, in ms from race start
 * @param paragraphs the race's text, so a finished line can be counted in characters
 */
export const replayRun = (
    events: readonly TypingEvent[],
    endedAtMs: number,
    paragraphs: readonly Paragraph[],
    faceOfRoll: FaceOfRoll
): PlayerRun => {
    const state = newRunState();

    for (const event of events) {
        if (state.end !== null) break;

        // Typing is closed during the pause between paragraphs.
        if (event.atMs < state.paragraphStartedAtMs) continue;

        // Time ran out on this paragraph before the event happened.
        if (event.atMs > paragraphDeadlineMs(state)) {
            eliminate(state, paragraphDeadlineMs(state), 'time');
            break;
        }

        if (event.kind === 'mistake') applyMistake(state, event.atMs, faceOfRoll);
        else applyLineDone(state, event.atMs, paragraphs);
    }

    // The client stopped after the deadline passed without finishing the paragraph.
    if (state.end === null && endedAtMs > paragraphDeadlineMs(state)) {
        eliminate(state, paragraphDeadlineMs(state), 'time');
    }

    return {
        status: state.end?.status ?? 'unfinished',
        endedAtMs: state.end?.atMs ?? endedAtMs,
        paragraphsDone: state.paragraphIndex,
        linesDone: state.linesDone,
        charsDone: state.charsDone,
        rollsCast: state.rollsCast,
        cause: state.end?.cause ?? null
    };
};

/**
 * Best first: finishers by who finished sooner; then everyone else by how far
 * they got (characters typed), and for the same distance, by who lasted longer.
 */
export const compareRuns = (a: PlayerRun, b: PlayerRun): number => {
    const aFinished = a.status === 'finished';
    const bFinished = b.status === 'finished';
    if (aFinished && bFinished) return a.endedAtMs - b.endedAtMs;
    if (aFinished !== bFinished) return aFinished ? -1 : 1;

    if (a.charsDone !== b.charsDone) return b.charsDone - a.charsDone;

    const survivalMs = (run: PlayerRun): number =>
        run.status === 'eliminated' ? run.endedAtMs : Number.POSITIVE_INFINITY;
    if (survivalMs(a) !== survivalMs(b)) return survivalMs(a) > survivalMs(b) ? -1 : 1;
    return 0;
};

export interface PlayerRunEntry {
    playerId: string;
    run: PlayerRun;
}

export interface LastSurvivor {
    playerId: string;
    /** When the last of the others was knocked out: the race is over from this moment. */
    wonAtMs: number;
}

/**
 * The last survivor: the one player left standing once every other player has
 * been knocked out, who then wins without having to finish the text.
 *
 * Needs at least two players. There is no last survivor if two or more are
 * never knocked out, or if the last two fall at the same instant. Anyone who
 * has finished or simply stopped counts as still standing.
 */
export const findLastSurvivor = (entries: readonly PlayerRunEntry[]): LastSurvivor | null => {
    if (entries.length < 2) return null;

    const knockedOutAtMs = (entry: PlayerRunEntry): number =>
        entry.run.status === 'eliminated' ? entry.run.endedAtMs : Number.POSITIVE_INFINITY;

    const byKnockOut = [...entries].sort((a, b) => knockedOutAtMs(a) - knockedOutAtMs(b));
    const lastToFall = byKnockOut[byKnockOut.length - 2]!;
    const survivor = byKnockOut[byKnockOut.length - 1]!;

    const everyoneElseIsOut = Number.isFinite(knockedOutAtMs(lastToFall));
    const survivorOutlastsThem = knockedOutAtMs(survivor) > knockedOutAtMs(lastToFall);
    return everyoneElseIsOut && survivorOutlastsThem
        ? { playerId: survivor.playerId, wonAtMs: knockedOutAtMs(lastToFall) }
        : null;
};

export const isSameRun = (a: PlayerRun, b: PlayerRun): boolean => compareRuns(a, b) === 0;
