/**
 * Minefield as a self-timed game module.
 *
 * Every player runs the same field of hidden mines, from the start to the
 * finish line, with the arrow keys or WASD. Walking within a mine's trigger
 * radius sets it off and costs a life; the second lost life ends your race.
 * Space sends out a sonar pulse that briefly shows the mines nearby, but the
 * runner stands still while it scans and it needs time to recharge, so the
 * game is balancing scanning, luck and pressing forward. First across the line
 * wins; everyone else loses.
 *
 * Mines are shared: a mine goes off once, and hurts every runner inside its
 * radius at that moment, so two runners close together can both be hit by the
 * same one, and a mine one runner sets off is gone for the rest.
 *
 * The browser plays its own race and reports every key change and sonar press
 * with a time; the server replays all players together with the same code
 * (simulate.ts), so the order things happened in is decided from the reported
 * times and not from when messages arrived. The mine positions are part of
 * the round data, so a player reading the network traffic could see them: this
 * game trusts the room not to.
 */

import { assignSharedRanks } from '../ranking';
import type { RandomSource } from '../random';
import type { RankedEntry, ResultEntry, SelfTimedGameModule } from '../selfTimed';
import { MINEFIELD } from './constants';
import { generateMap } from './map';
import { parseMinefieldProgress, parseMinefieldResult } from './parsing';
import { simulateRace, type RunOutcome } from './simulate';
import type { MinefieldResult, MinefieldRound } from './types';

export const createRoundData = (random: RandomSource = Math.random): MinefieldRound => ({
    map: generateMap(random)
});

/** Measured from when timing starts, like every self-timed game. */
const resultTimeoutMs = (): number => MINEFIELD.MAX_RACE_MS + MINEFIELD.RESULT_GRACE_MS;

/**
 * Best first: whoever finished earliest; then those still running when the
 * race ended, by how far they got; then the knocked-out, by who lasted longest
 * and then who got further.
 */
export const compareRuns = (a: RunOutcome, b: RunOutcome): number => {
    if (a.finishedAtMs !== null && b.finishedAtMs !== null) {
        return a.finishedAtMs - b.finishedAtMs;
    }
    if (a.finishedAtMs !== null) return -1;
    if (b.finishedAtMs !== null) return 1;

    const aOut = a.eliminatedAtMs !== null;
    const bOut = b.eliminatedAtMs !== null;
    if (aOut !== bOut) return aOut ? 1 : -1;
    if (aOut && bOut && a.eliminatedAtMs !== b.eliminatedAtMs) {
        return b.eliminatedAtMs! - a.eliminatedAtMs!;
    }
    return b.maxX - a.maxX;
};

export const isSameRun = (a: RunOutcome, b: RunOutcome): boolean => compareRuns(a, b) === 0;

const rank = (
    entries: ResultEntry<MinefieldResult>[],
    round: MinefieldRound
): RankedEntry[] => {
    // Everyone is replayed together on the one field, since a mine one runner
    // sets off is gone, or hurts them, for the others. The replay stops by
    // itself the moment someone crosses the line.
    const race = simulateRace(
        round.map,
        entries.map(({ playerId, result }) => ({ playerId, inputs: result.inputs }))
    );
    const raceEnded = race.winners.length > 0;

    const rows = entries
        .map(({ playerId, result }) => ({
            playerId,
            result,
            outcome: race.outcomes.get(playerId)!
        }))
        .sort(
            (a, b) => compareRuns(a.outcome, b.outcome) || a.playerId.localeCompare(b.playerId)
        );

    return assignSharedRanks(rows, (a, b) => isSameRun(a.outcome, b.outcome)).map(
        ({ item, rank: position }) => ({
            playerId: item.playerId,
            rank: position,
            reported: true,
            detail: {
                finished: item.outcome.finishedAtMs !== null,
                ...(item.outcome.finishedAtMs !== null && {
                    finishedAtMs: item.outcome.finishedAtMs
                }),
                livesLeft: item.outcome.livesLeft,
                minesHit: item.outcome.detonations.length,
                sonarScans: item.outcome.scans.length,
                progressX: Math.round(item.outcome.maxX * 10),
                ...(item.outcome.eliminatedAtMs !== null && {
                    eliminatedAtMs: item.outcome.eliminatedAtMs
                }),
                ...(raceEnded && { raceEndedAtMs: race.endedAtMs }),
                timingSuspect: item.result.timingSuspect
            }
        })
    );
};

/**
 * Once a player has crossed the finish line the race is over for everyone, so
 * the others must stop and report: they can't tell except by watching. This
 * replays only the players who have reported so far, so it is a prompt to
 * stop and not a verdict: the final ranking replays everyone.
 */
const shouldCloseEarly = (
    reported: readonly MinefieldResult[],
    _participantCount: number,
    round: MinefieldRound
): boolean =>
    simulateRace(
        round.map,
        reported.map((result, index) => ({ playerId: String(index), inputs: result.inputs }))
    ).winners.length > 0;

export const minefieldModule: SelfTimedGameModule<MinefieldRound, MinefieldResult> = {
    id: 'minefield',
    title: 'Minefield',
    kind: 'self-timed',
    roundsPerGame: MINEFIELD.ROUNDS_PER_GAME,
    finishAnimationMs: MINEFIELD.FINISH_ANIMATION_MS,
    createRoundData: () => createRoundData(),
    parseResult: (raw) => parseMinefieldResult(raw),
    parseProgress: (raw, round) => parseMinefieldProgress(raw, round.map.mines.length),
    shouldCloseEarly,
    resultTimeoutMs,
    rank
};
