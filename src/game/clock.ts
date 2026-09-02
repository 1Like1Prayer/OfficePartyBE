/**
 * A monotonic clock. Never wall-clock time: an OS clock adjustment mid-match
 * should not move a deadline (section 9).
 *
 * The Clock interface is injectable so rounds can be driven by a fake clock
 * in tests without waiting in real time.
 */

export type TimerHandle = { readonly id: number };

export interface Clock {
    /** Milliseconds since process start. Monotonic, fractional. */
    now(): number;
    setTimeout(fn: () => void, delayMs: number): TimerHandle;
    clearTimeout(handle: TimerHandle | null): void;
}

const ORIGIN_NS = process.hrtime.bigint();

export const monotonicNowMs = (): number =>
    Number(process.hrtime.bigint() - ORIGIN_NS) / 1e6;

export const systemClock: Clock = {
    now: monotonicNowMs,
    setTimeout(fn, delayMs) {
        const timeout = setTimeout(fn, Math.max(0, delayMs));
        // Node's Timeout is opaque to us; carry it through as the handle.
        return timeout as unknown as TimerHandle;
    },
    clearTimeout(handle) {
        if (handle) clearTimeout(handle as unknown as NodeJS.Timeout);
    }
};

/**
 * A manually advanced clock for tests. `advance` fires every timer whose
 * deadline has passed, in deadline order, including timers scheduled by
 * those callbacks.
 */
export class FakeClock implements Clock {
    private currentMs = 0;
    private nextId = 1;
    private timers = new Map<number, { at: number; fn: () => void }>();

    now(): number {
        return this.currentMs;
    }

    setTimeout(fn: () => void, delayMs: number): TimerHandle {
        const id = this.nextId++;
        this.timers.set(id, { at: this.currentMs + Math.max(0, delayMs), fn });
        return { id };
    }

    clearTimeout(handle: TimerHandle | null): void {
        if (handle) this.timers.delete(handle.id);
    }

    advance(byMs: number): void {
        const target = this.currentMs + byMs;
        for (;;) {
            let nextId: number | null = null;
            let nextAt = Infinity;
            for (const [id, timer] of this.timers) {
                if (timer.at <= target && timer.at < nextAt) {
                    nextAt = timer.at;
                    nextId = id;
                }
            }
            if (nextId === null) break;
            const timer = this.timers.get(nextId)!;
            this.timers.delete(nextId);
            this.currentMs = timer.at;
            timer.fn();
        }
        this.currentMs = target;
    }
}
