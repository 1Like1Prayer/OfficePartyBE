/**
 * Type Racer Roulette as a self-timed game module.
 *
 * Each player types through the same paragraphs, line by line. A mistake
 * restarts the line and costs a strike; three strikes in a paragraph cast a
 * dice of hearts and skulls, and a skull knocks you out. Survive and the next
 * roll has one more skull. First to finish every paragraph wins; a paragraph
 * left unfinished after three minutes also knocks you out.
 *
 * The browser validates typing locally so every key press is instant, and
 * reports what happened with timestamps. The server replays it (see
 * replay.ts) and rolls the dice itself, so the outcome of a roll stays a
 * surprise: the client asks for it mid-race through `handleAction`.
 *
 * The die's randomness is injected (`rollFace`), because it needs a server
 * secret and this module is shared with the browser.
 */

import { assignSharedRanks } from '../ranking';
import type { RandomSource } from '../random';
import type { RankedEntry, ResultEntry, SelfTimedGameModule } from '../selfTimed';
import { TYPE_RACER } from './constants';
import { describeRoll } from './dice';
import { parseRollAction, parseTypeRacerProgress, parseTypeRacerResult } from './parsing';
import { locateOnBar, totalCharacters } from './progress';
import {
    compareRuns,
    findLastSurvivor,
    isSameRun,
    replayRun,
    type PlayerRun,
    type PlayerRunEntry
} from './replay';
import { createTypeRacerRound } from './roundData';
import type { DieRoll, RollFace, TypeRacerResult, TypeRacerRound } from './types';

/** The longest the race can take: every paragraph run to its limit, with every pause. */
const resultTimeoutMs = (round: TypeRacerRound): number => {
    const pauses = round.paragraphs.length - 1;
    return (
        round.paragraphs.length * TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS +
        pauses * TYPE_RACER.PARAGRAPH_PAUSE_MS +
        TYPE_RACER.RESULT_GRACE_MS
    );
};

export const createTypeRacerModule = (
    rollFace: RollFace,
    random: RandomSource = Math.random
): SelfTimedGameModule<TypeRacerRound, TypeRacerResult> => {
    /**
     * `raceEndedAtMs` cuts the replay short for the last survivor: once every
     * other player is out the race is over, so nothing they did afterwards counts.
     */
    const runOf = (
        playerId: string,
        result: TypeRacerResult,
        round: TypeRacerRound,
        raceEndedAtMs = Number.POSITIVE_INFINITY
    ): PlayerRun =>
        replayRun(
            result.events.filter((event) => event.atMs <= raceEndedAtMs),
            Math.min(result.endedAtMs, raceEndedAtMs),
            round.paragraphs,
            (rollIndex) => rollFace(round.rollNonce, playerId, rollIndex)
        );

    const rank = (
        entries: ResultEntry<TypeRacerResult>[],
        round: TypeRacerRound
    ): RankedEntry[] => {
        const fullRuns: PlayerRunEntry[] = entries.map(({ playerId, result }) => ({
            playerId,
            run: runOf(playerId, result, round)
        }));

        // When everyone else has been knocked out, the one left standing wins.
        const lastSurvivor = findLastSurvivor(fullRuns);
        const isLastSurvivor = (playerId: string): boolean => lastSurvivor?.playerId === playerId;

        const scored = entries
            .map(({ playerId, result }) => ({
                playerId,
                timingSuspect: result.timingSuspect,
                lastSurvivor: isLastSurvivor(playerId),
                run:
                    lastSurvivor !== null && isLastSurvivor(playerId)
                        ? runOf(playerId, result, round, lastSurvivor.wonAtMs)
                        : fullRuns.find((entry) => entry.playerId === playerId)!.run
            }))
            .sort(
                (a, b) =>
                    Number(b.lastSurvivor) - Number(a.lastSurvivor) ||
                    compareRuns(a.run, b.run) ||
                    a.playerId.localeCompare(b.playerId)
            );

        // The last survivor wins outright; it can't tie with anyone.
        const isTie = (a: (typeof scored)[number], b: (typeof scored)[number]): boolean =>
            !a.lastSurvivor && !b.lastSurvivor && isSameRun(a.run, b.run);

        return assignSharedRanks(scored, isTie).map(
            ({ item, rank: position }) => ({
                playerId: item.playerId,
                rank: position,
                reported: true,
                detail: {
                    status: item.run.status,
                    endedAtMs: item.run.endedAtMs,
                    paragraphsDone: item.run.paragraphsDone,
                    paragraphCount: round.paragraphs.length,
                    linesDone: item.run.linesDone,
                    charsDone: item.run.charsDone,
                    totalChars: totalCharacters(round.paragraphs),
                    barFraction: locateOnBar(round.paragraphs, item.run.charsDone).fractionOfBar,
                    rollsCast: item.run.rollsCast,
                    ...(item.run.cause !== null && { eliminatedBy: item.run.cause }),
                    lastSurvivor: item.lastSurvivor,
                    timingSuspect: item.timingSuspect
                }
            })
        );
    };

    /** The player asks for the outcome of a dice roll. */
    const handleAction = (
        round: TypeRacerRound,
        playerId: string,
        raw: unknown
    ): DieRoll | null => {
        const action = parseRollAction(raw);
        if (action === null) return null;
        return describeRoll(rollFace(round.rollNonce, playerId, action.rollIndex), action.rollIndex);
    };

    return {
        id: 'type-racer-roulette',
        title: 'Type Racer Roulette',
        kind: 'self-timed',
        roundsPerGame: TYPE_RACER.ROUNDS_PER_GAME,
        finishAnimationMs: TYPE_RACER.FINISH_ANIMATION_MS,
        createRoundData: () => createTypeRacerRound(random),
        parseResult: (raw) => parseTypeRacerResult(raw),
        parseProgress: (raw, round) => parseTypeRacerProgress(raw, round),
        resultTimeoutMs,
        rank,
        handleAction
    };
};
