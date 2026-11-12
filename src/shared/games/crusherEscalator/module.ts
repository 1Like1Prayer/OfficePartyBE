/**
 * Crusher Escalator as a self-timed game module.
 *
 * Every player climbs their own looping stream of arrows. Pressing the arrow
 * that's showing scores a point; the arrow changes on every press. Fall
 * ELIMINATION_GAP points behind your group's leader and you are crushed.
 *
 * With more than FINALISTS players, the first stage is two even heats that
 * run together until FINALISTS players are left. After a short pause those
 * players race again, all in one group and starting from 0, for the final.
 * Last one standing in the final wins.
 *
 * The browser runs its own race and reports every press with a time; the
 * server replays all players together (see race.ts). That keeps the game
 * latency-proof like the other self-timed games, while still letting players
 * affect each other through the leader's score. The heats and the final are
 * two attempts of one scoring round, driven by the runner's `nextStage` hook.
 */

import { SELF_TIMED } from '../../constants';
import { assignSharedRanks } from '../ranking';
import type { RandomSource } from '../random';
import type {
    AttemptTiming,
    RankedEntry,
    ResultEntry,
    RoundContext,
    SelfTimedGameModule,
    StageAdvance
} from '../selfTimed';
import { CRUSHER_ESCALATOR } from './constants';
import { splitIntoTwoGroups } from './groups';
import { parseCrusherEscalatorProgress, parseCrusherEscalatorResult } from './parsing';
import {
    compareOutcomes,
    isSameOutcome,
    simulateRace,
    type RaceOutcome,
    type Racer
} from './race';
import { generatePlayerStreams } from './stream';
import type {
    CrusherEscalatorResult,
    CrusherEscalatorRound,
    RaceStage
} from './types';

/** Heats only when there are too many players and it is the opening attempt. */
const stageFor = ({ playerIds, attempt }: RoundContext): RaceStage =>
    attempt === 0 && playerIds.length > CRUSHER_ESCALATOR.FINALISTS ? 'heats' : 'final';

const createRoundData = (
    context: RoundContext,
    random: RandomSource = Math.random
): CrusherEscalatorRound => {
    const stage = stageFor(context);
    return {
        stage,
        groups:
            stage === 'heats'
                ? splitIntoTwoGroups(context.playerIds, random)
                : [[...context.playerIds]],
        streams: generatePlayerStreams(context.playerIds, random)
    };
};

/** Measured from when timing starts, like every self-timed game. */
const resultTimeoutMs = (): number =>
    CRUSHER_ESCALATOR.MAX_RACE_MS + CRUSHER_ESCALATOR.RESULT_GRACE_MS;

const groupIdOf = (playerId: string, round: CrusherEscalatorRound): string =>
    String(round.groups.findIndex((group) => group.includes(playerId)));

const toRacers = (
    entries: ResultEntry<CrusherEscalatorResult>[],
    round: CrusherEscalatorRound
): Racer[] =>
    entries.flatMap(({ playerId, result }) => {
        const stream = round.streams[playerId];
        return stream === undefined
            ? []
            : [{ playerId, groupId: groupIdOf(playerId, round), inputs: result.inputs, stream }];
    });

/** The heats stop when the finalists are decided; the final when one is left. */
const survivorsToEnd = (round: CrusherEscalatorRound): number =>
    round.stage === 'heats' ? CRUSHER_ESCALATOR.FINALISTS : 1;

const rank = (
    entries: ResultEntry<CrusherEscalatorResult>[],
    round: CrusherEscalatorRound
): RankedEntry[] => {
    const timingSuspectByPlayer = new Map(
        entries.map(({ playerId, result }) => [playerId, result.timingSuspect])
    );

    const outcomes = simulateRace(toRacers(entries, round), {
        survivorsToEnd: survivorsToEnd(round)
    }).sort((a, b) => compareOutcomes(a, b) || a.playerId.localeCompare(b.playerId));

    return assignSharedRanks(outcomes, isSameOutcome).map(
        ({ item, rank: position }: { item: RaceOutcome; rank: number }) => ({
            playerId: item.playerId,
            rank: position,
            reported: true,
            detail: {
                stage: round.stage,
                score: item.score,
                survived: item.eliminatedAtMs === null,
                ...(item.eliminatedAtMs !== null && {
                    eliminatedAtMs: item.eliminatedAtMs
                }),
                timingSuspect: timingSuspectByPlayer.get(item.playerId) ?? false
            }
        })
    );
};

/**
 * After the heats, the best FINALISTS players go through. Players level with
 * the last qualifier go through too, so a tie never knocks someone out by
 * luck of ordering. Returns null when the round is over (a final, or fewer
 * than two players to race).
 */
const nextStage = (
    ranked: RankedEntry[],
    round: CrusherEscalatorRound
): StageAdvance | null => {
    if (round.stage !== 'heats') return null;

    const lastQualifier = ranked[CRUSHER_ESCALATOR.FINALISTS - 1];
    const finalists =
        lastQualifier === undefined
            ? ranked
            : ranked.filter((row) => row.rank <= lastQualifier.rank);
    if (finalists.length < 2) return null;

    return {
        participants: finalists.map((row) => row.playerId),
        pauseMs: CRUSHER_ESCALATOR.FINAL_PAUSE_MS,
        timing: {
            startLeadMs: CRUSHER_ESCALATOR.FINAL_START_LEAD_MS,
            countdownMs: CRUSHER_ESCALATOR.FINAL_COUNTDOWN_MS
        }
    };
};

/** Heats open with the usual countdown plus time for the heat-sorting animation. */
const openingTiming = (round: CrusherEscalatorRound): AttemptTiming | null =>
    round.stage === 'heats'
        ? {
              startLeadMs: SELF_TIMED.START_LEAD_MS,
              countdownMs:
                  SELF_TIMED.COUNTDOWN_MS + CRUSHER_ESCALATOR.HEATS_EXTRA_ANIMATION_MS
          }
        : null;

/**
 * The race is over once only `survivorsToEnd` players are left, so as soon as
 * that many fewer than everyone have been crushed and reported, the players
 * still racing must stop and report: they can't tell the race has ended
 * except by watching others.
 */
const shouldCloseEarly = (
    reported: readonly CrusherEscalatorResult[],
    participantCount: number,
    round: CrusherEscalatorRound
): boolean => reported.length >= 1 && participantCount - reported.length <= survivorsToEnd(round);

export const crusherEscalatorModule: SelfTimedGameModule<
    CrusherEscalatorRound,
    CrusherEscalatorResult
> = {
    id: 'crusher-escalator',
    title: 'Crusher Escalator',
    kind: 'self-timed',
    roundsPerGame: CRUSHER_ESCALATOR.ROUNDS_PER_GAME,
    finishAnimationMs: CRUSHER_ESCALATOR.FINISH_ANIMATION_MS,
    createRoundData: (context) => createRoundData(context),
    parseResult: (raw) => parseCrusherEscalatorResult(raw),
    parseProgress: (raw) => parseCrusherEscalatorProgress(raw),
    resultTimeoutMs,
    rank,
    openingTiming,
    nextStage,
    shouldCloseEarly
};
