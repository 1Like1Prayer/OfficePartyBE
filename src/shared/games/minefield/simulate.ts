/**
 * The race, replayed.
 *
 * The browser plays its own race and reports every key change and sonar press
 * with a time; the browser and the server then both run exactly this code over
 * those inputs, so explosions, lives and finish times are decided the same way
 * everywhere.
 *
 * Runners share the field, so what one does affects the others. A mine goes
 * off when a runner comes within TRIGGER_RADIUS of it, and the blast hits every
 * runner inside that radius at that moment, so two runners standing close
 * together can both lose a life to the same mine. A mine goes off once: after
 * that it is gone for everyone.
 *
 * The race is simulated in fixed steps (STEP_MS). In each step, in this order:
 *  1. inputs that have happened by now take effect;
 *  2. every runner moves, unless a sonar scan or an explosion is holding them still;
 *  3. anyone across the finish line has finished, and that ends the race;
 *  4. every live mine that a runner is close enough to set off goes off, and
 *     hits all the runners within its radius. A runner who was hit recently is
 *     protected: they neither set mines off nor get hurt for a moment.
 * Losing the last life takes a runner out of the race.
 *
 * All runners are judged from the same snapshot of positions in each step, so
 * the result never depends on the order the runners are listed in.
 *
 * Plain functions over plain data: no sockets, no clock.
 */

import { MINEFIELD } from './constants';
import type { Input, MinefieldMap, Mine } from './types';

export interface Detonation {
    atMs: number;
    /** Index into the map's mine list. */
    mineIndex: number;
}

export interface Scan {
    atMs: number;
    x: number;
    y: number;
}

export interface RunOutcome {
    /** When the runner crossed the finish line, or null if they never did. */
    finishedAtMs: number | null;
    /** When the last life was lost, or null if they never were. */
    eliminatedAtMs: number | null;
    livesLeft: number;
    /** Where the runner was when they stopped (or when the race ended). */
    x: number;
    y: number;
    /** The furthest they got towards the finish. */
    maxX: number;
    /** The explosions that hurt this runner. */
    detonations: Detonation[];
    /** Each sonar scan: when it started and where the runner stood (presses that were still cooling down are not here). */
    scans: Scan[];
    /** The time this runner's part of the race stopped. */
    endedAtMs: number;
}

export interface Runner {
    playerId: string;
    inputs: readonly Input[];
}

export interface RaceOutcome {
    outcomes: Map<string, RunOutcome>;
    /** Every mine that went off, once each, whoever it hurt. */
    explosions: Detonation[];
    /** When the race ended: the first finish, or the time limit. */
    endedAtMs: number;
    /** Who crossed the line first (several if on the same step), or empty. */
    winners: string[];
}

const MARGIN = 0.5;
const TRIGGER_RADIUS_SQUARED = MINEFIELD.TRIGGER_RADIUS * MINEFIELD.TRIGGER_RADIUS;
const STEP_DISTANCE = (MINEFIELD.SPEED_TILES_PER_S * MINEFIELD.STEP_MS) / 1000;

const clamp = (value: number, min: number, max: number): number =>
    Math.min(Math.max(value, min), max);

const distanceSquared = (mine: Mine, x: number, y: number): number =>
    (mine.x - x) ** 2 + (mine.y - y) ** 2;

interface RunnerState {
    playerId: string;
    inputs: readonly Input[];
    nextInput: number;
    x: number;
    y: number;
    maxX: number;
    dx: number;
    dy: number;
    livesLeft: number;
    /** Still during a scan or an explosion. */
    holdUntil: number;
    /** Mines are harmless to, and ignored by, this runner until then. */
    protectedUntil: number;
    sonarReadyAt: number;
    /** Still in the race: not finished and not knocked out. */
    active: boolean;
    finishedAtMs: number | null;
    eliminatedAtMs: number | null;
    detonations: Detonation[];
    scans: Scan[];
    endedAtMs: number;
}

const startRunner = (map: MinefieldMap, runner: Runner): RunnerState => ({
    playerId: runner.playerId,
    inputs: runner.inputs,
    nextInput: 0,
    x: map.startX,
    y: map.startY,
    maxX: map.startX,
    dx: 0,
    dy: 0,
    livesLeft: MINEFIELD.LIVES,
    holdUntil: 0,
    protectedUntil: 0,
    sonarReadyAt: 0,
    active: true,
    finishedAtMs: null,
    eliminatedAtMs: null,
    detonations: [],
    scans: [],
    endedAtMs: 0
});

/** Applies the inputs that have happened by `now`, then moves the runner. */
const stepRunner = (map: MinefieldMap, runner: RunnerState, now: number): void => {
    runner.endedAtMs = now;

    while (runner.nextInput < runner.inputs.length && runner.inputs[runner.nextInput]!.atMs <= now) {
        const input = runner.inputs[runner.nextInput]!;
        runner.nextInput++;
        if (input.kind === 'move') {
            runner.dx = input.dx;
            runner.dy = input.dy;
        } else if (now >= runner.sonarReadyAt && now >= runner.holdUntil) {
            runner.scans.push({ atMs: now, x: runner.x, y: runner.y });
            runner.holdUntil = now + MINEFIELD.SONAR_ANIMATION_MS;
            runner.sonarReadyAt = now + MINEFIELD.SONAR_COOLDOWN_MS;
        }
    }

    if (now >= runner.holdUntil && (runner.dx !== 0 || runner.dy !== 0)) {
        const length = Math.hypot(runner.dx, runner.dy);
        runner.x = clamp(runner.x + (runner.dx / length) * STEP_DISTANCE, MARGIN, map.width - MARGIN);
        runner.y = clamp(runner.y + (runner.dy / length) * STEP_DISTANCE, MARGIN, map.height - MARGIN);
        runner.maxX = Math.max(runner.maxX, runner.x);
    }
};

/** The live mine this runner is close enough to set off: the nearest, if several. */
const nearestMineInRange = (
    mines: readonly Mine[],
    gone: ReadonlySet<number>,
    runner: RunnerState
): number | null => {
    let nearest: number | null = null;
    let nearestDistance = Infinity;
    for (const [index, mine] of mines.entries()) {
        if (gone.has(index)) continue;
        const distance = distanceSquared(mine, runner.x, runner.y);
        if (distance <= TRIGGER_RADIUS_SQUARED && distance < nearestDistance) {
            nearest = index;
            nearestDistance = distance;
        }
    }
    return nearest;
};

/** Sets off every mine a runner has walked into, hurting everyone in range. */
const explodeMines = (
    map: MinefieldMap,
    runners: readonly RunnerState[],
    gone: Set<number>,
    explosions: Detonation[],
    now: number
): void => {
    const vulnerable = runners.filter((runner) => runner.active && now >= runner.protectedUntil);

    // First work out which mines go off, from where everyone is right now.
    const setOff = new Set<number>();
    for (const runner of vulnerable) {
        const mineIndex = nearestMineInRange(map.mines, gone, runner);
        if (mineIndex !== null) setOff.add(mineIndex);
    }
    if (setOff.size === 0) return;

    // Then hurt everyone inside any of them, once each.
    for (const runner of vulnerable) {
        let nearest: number | null = null;
        let nearestDistance = Infinity;
        for (const mineIndex of setOff) {
            const distance = distanceSquared(map.mines[mineIndex]!, runner.x, runner.y);
            if (
                distance <= TRIGGER_RADIUS_SQUARED &&
                (distance < nearestDistance || (distance === nearestDistance && mineIndex < nearest!))
            ) {
                nearest = mineIndex;
                nearestDistance = distance;
            }
        }
        if (nearest === null) continue;

        runner.detonations.push({ atMs: now, mineIndex: nearest });
        runner.livesLeft--;
        if (runner.livesLeft <= 0) {
            runner.eliminatedAtMs = now;
            runner.active = false;
        } else {
            runner.holdUntil = Math.max(runner.holdUntil, now + MINEFIELD.EXPLOSION_ANIMATION_MS);
            runner.protectedUntil = now + MINEFIELD.INVULNERABLE_MS;
        }
    }

    for (const mineIndex of [...setOff].sort((a, b) => a - b)) {
        gone.add(mineIndex);
        explosions.push({ atMs: now, mineIndex });
    }
};

export const simulateRace = (
    map: MinefieldMap,
    entrants: readonly Runner[],
    untilMs: number = MINEFIELD.MAX_RACE_MS
): RaceOutcome => {
    const endMs = Math.min(untilMs, MINEFIELD.MAX_RACE_MS);
    // A fixed order, so nothing can depend on how the caller listed the runners.
    const runners = entrants
        .map((entrant) => startRunner(map, entrant))
        .sort((a, b) => a.playerId.localeCompare(b.playerId));
    const gone = new Set<number>();
    const explosions: Detonation[] = [];
    let raceEndedAtMs = 0;
    let winners: string[] = [];

    for (let step = 0; ; step++) {
        const now = step * MINEFIELD.STEP_MS;
        if (now > endMs) break;
        raceEndedAtMs = now;

        for (const runner of runners) {
            if (runner.active) stepRunner(map, runner, now);
        }

        const finishers = runners.filter((runner) => runner.active && runner.x >= map.finishX);
        if (finishers.length > 0) {
            for (const runner of finishers) {
                runner.finishedAtMs = now;
                runner.active = false;
            }
            winners = finishers.map((runner) => runner.playerId);
            break;
        }

        explodeMines(map, runners, gone, explosions, now);
    }

    return {
        outcomes: new Map(
            runners.map((runner) => [
                runner.playerId,
                {
                    finishedAtMs: runner.finishedAtMs,
                    eliminatedAtMs: runner.eliminatedAtMs,
                    livesLeft: Math.max(runner.livesLeft, 0),
                    x: runner.x,
                    y: runner.y,
                    maxX: runner.maxX,
                    detonations: runner.detonations,
                    scans: runner.scans,
                    endedAtMs: runner.endedAtMs
                }
            ])
        ),
        explosions,
        endedAtMs: raceEndedAtMs,
        winners
    };
};

/** One runner alone on the field: the same rules, with nobody to share the mines with. */
export const simulateRun = (
    map: MinefieldMap,
    inputs: readonly Input[],
    untilMs: number = MINEFIELD.MAX_RACE_MS
): RunOutcome =>
    simulateRace(map, [{ playerId: 'solo', inputs }], untilMs).outcomes.get('solo')!;

/**
 * The mines a sonar scan at this spot reveals, as indices into the map's mine
 * list. Mines that have already gone off are skipped.
 */
export const minesInSonarRange = (
    map: MinefieldMap,
    x: number,
    y: number,
    gone: ReadonlySet<number> = new Set()
): number[] =>
    map.mines.flatMap((mine, index) =>
        !gone.has(index) &&
        (mine.x - x) ** 2 + (mine.y - y) ** 2 <= MINEFIELD.SONAR_RADIUS ** 2
            ? [index]
            : []
    );

/**
 * Whether a scan's pulse is still showing what it found at `nowMs`: from when
 * the scan animation finishes until the reveal runs out.
 */
export const isScanShowing = (scan: Scan, nowMs: number): boolean =>
    nowMs >= scan.atMs + MINEFIELD.SONAR_ANIMATION_MS &&
    nowMs < scan.atMs + MINEFIELD.SONAR_ANIMATION_MS + MINEFIELD.SONAR_REVEAL_MS;

/**
 * Every mine that should be showing right now. Sonar is shared: what any
 * player's scan finds is shown to every player, so pass the scans of the whole
 * race here, not just your own. Mines that have gone off are never shown.
 */
export const revealedMines = (
    map: MinefieldMap,
    scans: readonly Scan[],
    nowMs: number,
    gone: ReadonlySet<number> = new Set()
): number[] => {
    const showing = new Set<number>();
    for (const scan of scans) {
        if (!isScanShowing(scan, nowMs)) continue;
        for (const index of minesInSonarRange(map, scan.x, scan.y, gone)) showing.add(index);
    }
    return [...showing].sort((a, b) => a - b);
};
