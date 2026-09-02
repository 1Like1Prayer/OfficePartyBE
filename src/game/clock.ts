/**
 * A monotonic clock. Never wall-clock time: an OS clock adjustment mid-match
 * should not move a deadline (section 9).
 */

const ORIGIN_NS = process.hrtime.bigint();

/** Milliseconds since process start. Monotonic, fractional. */
export const monotonicNowMs = (): number =>
    Number(process.hrtime.bigint() - ORIGIN_NS) / 1e6;
