/**
 * Log Dodge as a self-timed game module.
 *
 * Every player runs in place on a treadmill while the same lineup of logs
 * (low or high) comes at them. There is no physics: each log has an
 * arrival time, and the player must press the matching action (jump or
 * duck) within HIT_WINDOW_MS of it. Three misses and you are out. The round
 * ramps up to full difficulty by HARD_FROM_MS (logs closer together, wider
 * angles) and stays there; everyone still
 * standing after DURATION_MS has survived. If only one player is left before
 * then, the logs stop at that moment and they win (see roundEndMs).
 *
 * The browser plays the round locally and reports every press with a time;
 * the server replays them against the schedule (see judge.ts), so latency
 * can't change who got hit. Survivors are ordered by fewest hits and then by
 * timing accuracy; anyone still level goes to the runner's tiebreaker, which
 * runs a fresh schedule for just those players, so a round still hands back
 * exactly one winner.
 */

import { assignSharedRanks } from '../ranking';
import type { RandomSource } from '../random';
import type { RankedEntry, ResultEntry, RoundContext, SelfTimedGameModule } from '../selfTimed';
import { LOG_DODGE } from './constants';
import { compareOutcomes, isSameOutcome, judgePlayer, type Outcome } from './judge';
import { parseLogDodgeProgress, parseLogDodgeResult } from './parsing';
import { generateLogs } from './schedule';
import type { LogDodgeResult, LogDodgeRound } from './types';

export const createRoundData = (
    _context: RoundContext,
    random: RandomSource = Math.random
): LogDodgeRound => ({
    durationMs: LOG_DODGE.DURATION_MS,
    logs: generateLogs(random)
});

/** Measured from when timing starts, like every self-timed game. */
const resultTimeoutMs = (round: LogDodgeRound): number =>
    round.durationMs + LOG_DODGE.RESULT_GRACE_MS;

/**
 * When the round stops early: the moment everyone but one player has been
 * knocked out. Null while two or more players are still standing at the
 * end (the full 60 s is played), or when only one player took part.
 */
export const roundEndMs = (outcomes: readonly Outcome[]): number | null => {
    if (outcomes.length < 2) return null;
    const knockouts = outcomes
        .flatMap((outcome) => (outcome.eliminatedAtMs === null ? [] : [outcome.eliminatedAtMs]))
        .sort((a, b) => a - b);
    // The (N-1)th knockout leaves one player. If it is shared with the Nth,
    // nobody is left and the round is a dead heat for the tiebreaker.
    return knockouts[outcomes.length - 2] ?? null;
};

const averageErrorMs = (outcome: Outcome): number =>
    outcome.dodged === 0 ? 0 : Math.round(outcome.totalErrorMs / outcome.dodged);

const rank = (
    entries: ResultEntry<LogDodgeResult>[],
    round: LogDodgeRound
): RankedEntry[] => {
    const full = entries.map(({ playerId, result }) => ({
        playerId,
        inputs: result.inputs,
        timingSuspect: result.timingSuspect,
        outcome: judgePlayer(round.logs, result.inputs)
    }));

    // Once one player is left standing the logs stop: nothing after that
    // moment counts for anyone, including the player who is left.
    const endedAtMs = roundEndMs(full.map((row) => row.outcome));
    const rows = (
        endedAtMs === null
            ? full
            : full.map((row) => ({
                  ...row,
                  outcome: judgePlayer(round.logs, row.inputs, endedAtMs)
              }))
    ).sort(
        (a, b) => compareOutcomes(a.outcome, b.outcome) || a.playerId.localeCompare(b.playerId)
    );

    return assignSharedRanks(rows, (a, b) => isSameOutcome(a.outcome, b.outcome)).map(
        ({ item, rank: position }) => ({
            playerId: item.playerId,
            rank: position,
            reported: true,
            detail: {
                hits: item.outcome.hits,
                dodged: item.outcome.dodged,
                survived: item.outcome.eliminatedAtMs === null,
                ...(item.outcome.eliminatedAtMs !== null && {
                    eliminatedAtMs: item.outcome.eliminatedAtMs
                }),
                ...(endedAtMs !== null && { roundEndedAtMs: endedAtMs }),
                averageErrorMs: averageErrorMs(item.outcome),
                timingSuspect: item.timingSuspect
            }
        })
    );
};

/**
 * When a player's result comes in, tell the room how they got on, straight from
 * the replay. A player who is knocked out shows as out to everyone even if
 * their own progress messages were lost, which is what lets the last player
 * standing know that the logs should stop.
 */
const progressFromResult = (
    result: LogDodgeResult,
    round: LogDodgeRound
): Record<string, number> | null => {
    const outcome = judgePlayer(round.logs, result.inputs);
    return outcome.eliminatedAtMs === null ? null : { hits: LOG_DODGE.MAX_HITS };
};

/** Once everyone but one player has reported, the last one must stop and report too. */
const shouldCloseEarly = (
    reported: readonly LogDodgeResult[],
    participantCount: number
): boolean =>
    participantCount >= 2 && reported.length >= 1 && participantCount - reported.length <= 1;

export const logDodgeModule: SelfTimedGameModule<LogDodgeRound, LogDodgeResult> = {
    id: 'log-dodge',
    title: 'Log Dodge',
    kind: 'self-timed',
    roundsPerGame: LOG_DODGE.ROUNDS_PER_GAME,
    finishAnimationMs: LOG_DODGE.FINISH_ANIMATION_MS,
    createRoundData: (context) => createRoundData(context),
    parseResult: (raw, round) => parseLogDodgeResult(raw, round.durationMs),
    parseProgress: (raw) => parseLogDodgeProgress(raw),
    progressFromResult,
    shouldCloseEarly,
    resultTimeoutMs,
    rank
};
