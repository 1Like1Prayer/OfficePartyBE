/**
 * Replays one player's presses against the schedule and works out what
 * happened. The server is the only judge: the browser's own idea of its hits
 * is for display.
 *
 * Rules:
 *  - A press within INPUT_COOLDOWN_MS of the previous accepted press is ignored.
 *  - An accepted press dodges the earliest undodged log of the matching height
 *    whose +-HIT_WINDOW_MS window contains it. A press that matches nothing
 *    does nothing (it still uses up the cooldown).
 *  - A log not dodged by the time its window closes is a hit.
 *  - The MAX_HITS-th hit eliminates the player, at the moment that log's window closed.
 *  - `untilMs` cuts the replay short: logs whose window closes after it are
 *    not counted. The round uses this to stop everything the moment only one
 *    player is left standing.
 */

import { COUNTER_ACTION, LOG_DODGE } from './constants';
import type { Input, Log } from './types';

export interface Outcome {
    hits: number;
    dodged: number;
    /** Sum of |press - arrival| over dodged logs. */
    totalErrorMs: number;
    /** When the player was knocked out, or null if they survived the round. */
    eliminatedAtMs: number | null;
}

export const judgePlayer = (
    logs: readonly Log[],
    inputs: readonly Input[],
    untilMs: number = Infinity
): Outcome => {
    const dodgedLogs = new Set<number>();
    let totalErrorMs = 0;
    const dodgedAt = new Map<number, number>();
    let lastAcceptedAt = -Infinity;

    for (const input of inputs) {
        if (input.atMs - lastAcceptedAt < LOG_DODGE.INPUT_COOLDOWN_MS) continue;
        lastAcceptedAt = input.atMs;

        const index = logs.findIndex(
            (log, i) =>
                !dodgedLogs.has(i) &&
                COUNTER_ACTION[log.height] === input.action &&
                Math.abs(input.atMs - log.arriveAtMs) <= LOG_DODGE.HIT_WINDOW_MS
        );
        if (index === -1) continue;

        dodgedLogs.add(index);
        dodgedAt.set(index, input.atMs);
    }

    const closesAt = (log: Log): number => log.arriveAtMs + LOG_DODGE.HIT_WINDOW_MS;

    const hitTimes = logs
        .flatMap((log, i) => (dodgedLogs.has(i) ? [] : [closesAt(log)]))
        .filter((closesAtMs) => closesAtMs <= untilMs)
        .sort((a, b) => a - b);

    const eliminatedAtMs = hitTimes[LOG_DODGE.MAX_HITS - 1] ?? null;
    // Logs after the knockout, or after the cut-off, never reached this player.
    const hits = eliminatedAtMs === null ? hitTimes.length : LOG_DODGE.MAX_HITS;

    const lastCounted = Math.min(untilMs, eliminatedAtMs ?? Infinity);
    let dodged = 0;
    for (const index of dodgedLogs) {
        const log = logs[index]!;
        if (closesAt(log) > lastCounted) continue;
        dodged++;
        totalErrorMs += Math.abs(dodgedAt.get(index)! - log.arriveAtMs);
    }

    return {
        hits,
        dodged,
        totalErrorMs,
        eliminatedAtMs
    };
};

/**
 * Best first: survivors ahead of the knocked-out, then (survivors) fewer
 * hits, then tighter timing; the knocked-out go by who lasted longest.
 */
export const compareOutcomes = (a: Outcome, b: Outcome): number => {
    if (a.eliminatedAtMs === null && b.eliminatedAtMs === null) {
        return a.hits - b.hits || averageError(a) - averageError(b);
    }
    if (a.eliminatedAtMs === null) return -1;
    if (b.eliminatedAtMs === null) return 1;
    return b.eliminatedAtMs - a.eliminatedAtMs;
};

export const isSameOutcome = (a: Outcome, b: Outcome): boolean => compareOutcomes(a, b) === 0;

/** Rounded so players are only separated by a difference worth the name. */
const averageError = (outcome: Outcome): number =>
    outcome.dodged === 0 ? 0 : Math.round(outcome.totalErrorMs / outcome.dodged);
