import type { ACTIONS, LOG_HEIGHTS } from './constants';

export type LogHeight = (typeof LOG_HEIGHTS)[number];
export type Action = (typeof ACTIONS)[number];

export interface Log {
    height: LogHeight;
    /** When the log reaches the player, in ms from the start of the round. */
    arriveAtMs: number;
    /** How long it is visible before arriving, so it appears at arriveAtMs - travelMs. */
    travelMs: number;
    /** Visual approach angle in degrees. Has no effect on judging. */
    angleDeg: number;
}

/**
 * Public round data. Every player faces the same logs, so the round is fair
 * and nothing in it needs hiding.
 */
export interface LogDodgeRound {
    durationMs: number;
    /** Sorted by arrival time. */
    logs: Log[];
}

/** One button press, timed by the client from when the round started. */
export interface Input {
    action: Action;
    atMs: number;
}

export interface LogDodgeResult {
    /** Every press the player made, in order. The server judges them. */
    inputs: Input[];
    /** The tab was backgrounded mid-round, so local timing may be off. */
    timingSuspect: boolean;
}
