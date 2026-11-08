/**
 * Cube Counter as a self-timed game module. This is the only file the runner
 * and registry know about; the rules live in the files beside it.
 *
 * Flash a scene of blocks, hide it, the player types how many they saw. Big
 * blocks count once. The browser runs the whole round on its own clock, so
 * latency can't change what anyone sees or how long they took.
 */

import { assignSharedRanks } from '../ranking';
import type { RankedEntry, ResultEntry, SelfTimedGameModule } from '../selfTimed';
import { CUBE_COUNTER } from './constants';
import { parseCubeCounterProgress, parseCubeCounterResult } from './parsing';
import { generatePuzzles } from './sceneGenerator';
import { compareScores, isSameScore, scoreResult } from './scoring';
import type { CubeCounterResult, CubeCounterRound } from './types';

const createRoundData = (): CubeCounterRound => ({ puzzles: generatePuzzles() });

/**
 * Worst case for an honest player: every flash, every answer used to its
 * limit, every pause, plus grace. Measured from when timing starts.
 */
const resultTimeoutMs = (round: CubeCounterRound): number => {
    const perPuzzleWaits =
        CUBE_COUNTER.ANSWER_LIMIT_MS + CUBE_COUNTER.PAUSE_BETWEEN_PUZZLES_MS;
    const totalFlashMs = round.puzzles.reduce((sum, puzzle) => sum + puzzle.flashMs, 0);
    return (
        totalFlashMs +
        round.puzzles.length * perPuzzleWaits +
        CUBE_COUNTER.RESULT_GRACE_MS
    );
};

const rank = (
    entries: ResultEntry<CubeCounterResult>[],
    round: CubeCounterRound
): RankedEntry[] => {
    const scored = entries
        .map(({ playerId, result }) => ({
            playerId,
            result,
            score: scoreResult(result, round.puzzles)
        }))
        .sort(
            (a, b) =>
                compareScores(a.score, b.score) || a.playerId.localeCompare(b.playerId)
        );

    return assignSharedRanks(scored, (a, b) => isSameScore(a.score, b.score)).map(
        ({ item, rank: position }) => ({
            playerId: item.playerId,
            rank: position,
            reported: true,
            detail: {
                correctCount: item.score.correctCount,
                puzzleCount: round.puzzles.length,
                correctAnswerMs: item.score.correctAnswerMs,
                timingSuspect: item.result.timingSuspect
            }
        })
    );
};

export const cubeCounterModule: SelfTimedGameModule<
    CubeCounterRound,
    CubeCounterResult
> = {
    id: 'cube-counter',
    title: 'Cube Counter',
    kind: 'self-timed',
    roundsPerGame: CUBE_COUNTER.ROUNDS_PER_GAME,
    createRoundData,
    parseResult: (raw, round) => parseCubeCounterResult(raw, round.puzzles.length),
    parseProgress: (raw, round) => parseCubeCounterProgress(raw, round.puzzles.length),
    resultTimeoutMs,
    rank
};
