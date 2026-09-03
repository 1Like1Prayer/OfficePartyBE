/**
 * Stop the Clock — rules only.
 *
 * Hit a whole-second target between 2 and 8 seconds. The client times itself
 * with performance.now() and reports integer milliseconds; the server never
 * measures anything, which is why 300 ms of latency cannot change who wins.
 *
 * Everything here is a plain function over plain data: no sockets, no clock,
 * no I/O.
 */

import type {
    RankedEntry,
    ResultEntry,
    SelfTimedGameModule
} from './selfTimed';

export const STOP_THE_CLOCK = {
    MIN_TARGET_MS: 2_000,
    MAX_TARGET_MS: 8_000,
    /** Targets land on whole seconds so they read cleanly as "4 s". */
    TARGET_STEP_MS: 1_000,
    /**
     * A stopped clock is nonsense past this point; anything longer is a stuck
     * tab or a fabricated number and is rejected rather than scored.
     */
    MAX_ELAPSED_MS: 60_000,
    /**
     * Slack on top of the target before the server resolves the round itself.
     * If someone never reports, the round closes at target + 4 s and is scored
     * from whatever arrived.
     */
    RESULT_GRACE_MS: 4_000
} as const;

export interface StopTheClockRound {
    /** Milliseconds the player is trying to hit. */
    targetMs: number;
}

export interface StopTheClockResult {
    /** Client-measured interval between the scheduled start and the stop press. */
    elapsedMs: number;
    /**
     * The client noticed its tab was backgrounded (and therefore its timers
     * throttled) during the round. Kept and shown rather than silently scored,
     * per section 15 of the plan.
     */
    timingSuspect: boolean;
}

/** Pick a whole-second target inside the allowed band. */
export const pickTargetMs = (): number => {
    const { MIN_TARGET_MS, MAX_TARGET_MS, TARGET_STEP_MS } = STOP_THE_CLOCK;
    const steps = (MAX_TARGET_MS - MIN_TARGET_MS) / TARGET_STEP_MS;
    return MIN_TARGET_MS + Math.floor(Math.random() * (steps + 1)) * TARGET_STEP_MS;
};

/** How far off a report is. Integer milliseconds, so ties are exact. */
export const errorMs = (
    result: StopTheClockResult,
    round: StopTheClockRound
): number => Math.abs(result.elapsedMs - round.targetMs);

export const parseResult = (raw: unknown): StopTheClockResult | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { elapsedMs, timingSuspect } = raw as Record<string, unknown>;
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return null;
    const rounded = Math.round(elapsedMs);
    if (rounded < 0 || rounded > STOP_THE_CLOCK.MAX_ELAPSED_MS) return null;
    return { elapsedMs: rounded, timingSuspect: timingSuspect === true };
};

/**
 * Progress is display-only — it tells opponents someone's clock is running.
 * It has no effect on the outcome and deliberately does not carry elapsed
 * time, which stays hidden until the reveal.
 */
export const parseProgress = (raw: unknown): Record<string, number> | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { running } = raw as Record<string, unknown>;
    if (typeof running !== 'boolean') return null;
    return { running: running ? 1 : 0 };
};

/**
 * Sort by absolute error, closest first. Equal error is a real tie and shares
 * a rank, which is the runner's signal to run a tiebreaker among just those
 * players. Anyone who never reported ranks below everyone who did.
 */
export const rank = (
    entries: ResultEntry<StopTheClockResult>[],
    round: StopTheClockRound
): RankedEntry[] => {
    const scored = entries
        .map((entry) => ({
            playerId: entry.playerId,
            error: errorMs(entry.result, round),
            result: entry.result
        }))
        .sort((a, b) => a.error - b.error || a.playerId.localeCompare(b.playerId));

    const ranked: RankedEntry[] = [];
    let lastError: number | null = null;
    let lastRank = 0;

    scored.forEach((entry, index) => {
        const isTie = lastError !== null && entry.error === lastError;
        const position = isTie ? lastRank : index + 1;
        lastError = entry.error;
        lastRank = position;
        ranked.push({
            playerId: entry.playerId,
            rank: position,
            reported: true,
            detail: {
                elapsedMs: entry.result.elapsedMs,
                errorMs: entry.error,
                targetMs: round.targetMs,
                timingSuspect: entry.result.timingSuspect
            }
        });
    });

    return ranked;
};

export const resultTimeoutMs = (round: StopTheClockRound): number =>
    round.targetMs + STOP_THE_CLOCK.RESULT_GRACE_MS;

export const stopTheClockModule: SelfTimedGameModule<
    StopTheClockRound,
    StopTheClockResult
> = {
    id: 'stop-the-clock',
    title: 'Stop the Clock',
    kind: 'self-timed',
    createRoundData: () => ({ targetMs: pickTargetMs() }),
    parseResult,
    parseProgress,
    resultTimeoutMs,
    rank
};
