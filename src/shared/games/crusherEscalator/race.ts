/**
 * The race rules, as a replay.
 *
 * Each browser plays on its own clock and reports every press with a time.
 * The server then replays all players' presses in time order and applies the
 * rules itself, so the outcome never depends on when messages arrived and a
 * client cannot simply claim a score.
 *
 * Rules:
 *  - everyone starts on STARTING_SCORE;
 *  - a press scores a point if it matches the arrow currently showing; the
 *    arrow moves on after every press, right or wrong;
 *  - when a group's leader (highest score in that group) is ELIMINATION_GAP
 *    or more points ahead of a player in the same group, that player is
 *    crushed and their score is frozen;
 *  - the race ends when only `survivorsToEnd` players are left in total
 *    (1 for a final, FINALISTS for the heats), or at MAX_RACE_MS.
 *
 * Plain functions over plain data: no sockets, no clock.
 */

import { CRUSHER_ESCALATOR } from './constants';
import { directionAt } from './stream';
import type { ArrowStream, Input } from './types';

export interface Racer {
    playerId: string;
    /** Who this player races against. The gap rule only looks inside a group. */
    groupId: string;
    inputs: readonly Input[];
    stream: ArrowStream;
}

export interface RaceRules {
    /** The race stops as soon as this many players (or fewer) are left. */
    survivorsToEnd: number;
}

export interface RaceOutcome {
    playerId: string;
    score: number;
    /** When the player was crushed, or null if they survived the race. */
    eliminatedAtMs: number | null;
}

interface RacerState extends RaceOutcome {
    groupId: string;
}

interface JudgedPress {
    playerId: string;
    atMs: number;
    points: number;
}

/** Judge each press against the arrow showing when it was made. */
const judgePresses = ({ playerId, inputs, stream }: Racer): JudgedPress[] =>
    inputs.map((input, pressIndex) => ({
        playerId,
        atMs: input.atMs,
        points:
            input.direction === directionAt(stream, pressIndex)
                ? CRUSHER_ESCALATOR.POINTS_PER_CORRECT_INPUT
                : 0
    }));

/** Groups presses that happened at the same millisecond, earliest first. */
const groupByTime = (presses: JudgedPress[]): JudgedPress[][] => {
    const sorted = [...presses].sort((a, b) => a.atMs - b.atMs);
    const groups: JudgedPress[][] = [];

    for (const press of sorted) {
        const lastGroup = groups[groups.length - 1];
        if (lastGroup !== undefined && lastGroup[0]!.atMs === press.atMs) {
            lastGroup.push(press);
        } else {
            groups.push([press]);
        }
    }
    return groups;
};

const isAlive = (state: RacerState): boolean => state.eliminatedAtMs === null;

const toOutcome = ({ playerId, score, eliminatedAtMs }: RacerState): RaceOutcome => ({
    playerId,
    score,
    eliminatedAtMs
});

export const simulateRace = (
    racers: readonly Racer[],
    rules: RaceRules
): RaceOutcome[] => {
    const states = new Map<string, RacerState>(
        racers.map(({ playerId, groupId }) => [
            playerId,
            {
                playerId,
                groupId,
                score: CRUSHER_ESCALATOR.STARTING_SCORE,
                eliminatedAtMs: null
            }
        ])
    );

    const survivors = (): RacerState[] => [...states.values()].filter(isAlive);

    const leadScoreOfGroup = (groupId: string): number =>
        Math.max(
            ...[...states.values()]
                .filter((state) => state.groupId === groupId)
                .map((state) => state.score)
        );

    for (const group of groupByTime(racers.flatMap(judgePresses))) {
        if (survivors().length <= rules.survivorsToEnd) break; // The race is over.

        // Everything at the same instant counts before anyone is crushed, so
        // simultaneous presses can't be decided by processing order.
        for (const press of group) {
            const state = states.get(press.playerId)!;
            if (isAlive(state)) state.score += press.points;
        }

        const atMs = group[0]!.atMs;
        for (const state of survivors()) {
            const lead = leadScoreOfGroup(state.groupId);
            if (lead - state.score >= CRUSHER_ESCALATOR.ELIMINATION_GAP) {
                state.eliminatedAtMs = atMs;
            }
        }
    }

    return racers.map(({ playerId }) => toOutcome(states.get(playerId)!));
};

/**
 * Best first: survivors, then whoever lasted longest. Within the same
 * survival time the higher score is better.
 */
export const compareOutcomes = (a: RaceOutcome, b: RaceOutcome): number => {
    const survivalMs = (outcome: RaceOutcome): number =>
        outcome.eliminatedAtMs ?? Number.POSITIVE_INFINITY;

    if (survivalMs(a) !== survivalMs(b)) return survivalMs(a) > survivalMs(b) ? -1 : 1;
    return b.score - a.score;
};

export const isSameOutcome = (a: RaceOutcome, b: RaceOutcome): boolean =>
    compareOutcomes(a, b) === 0;
