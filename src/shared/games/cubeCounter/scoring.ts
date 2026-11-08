/**
 * Turns a player's answers into a score and orders scores. Pure functions over
 * plain data, so the ranking rules can be tested without a round or a socket.
 *
 * The winner is whoever gets the correct answers in the quickest time: most
 * correct answers first, then the lowest total time spent on those correct
 * answers. Time on a wrong answer never counts, so answering fast and wrong
 * can't help anyone. A full tie is left to the runner's tiebreaker.
 */

import { countBlocks } from './sceneValidation';
import type { Answer, CubeCounterResult, Puzzle } from './types';

export interface RoundScore {
    correctCount: number;
    /** Total time taken on the correctly answered puzzles only. */
    correctAnswerMs: number;
}

export const isCorrect = (answer: Answer, puzzle: Puzzle): boolean =>
    answer.count === countBlocks(puzzle.boxes);

export const scoreResult = (
    result: CubeCounterResult,
    puzzles: readonly Puzzle[]
): RoundScore => {
    let correctCount = 0;
    let correctAnswerMs = 0;

    puzzles.forEach((puzzle, index) => {
        const answer = result.answers[index];
        if (answer === undefined || !isCorrect(answer, puzzle)) return;
        correctCount++;
        correctAnswerMs += answer.answerMs;
    });

    return { correctCount, correctAnswerMs };
};

/** Negative when `a` is the better score. */
export const compareScores = (a: RoundScore, b: RoundScore): number =>
    b.correctCount - a.correctCount || a.correctAnswerMs - b.correctAnswerMs;

export const isSameScore = (a: RoundScore, b: RoundScore): boolean =>
    compareScores(a, b) === 0;
