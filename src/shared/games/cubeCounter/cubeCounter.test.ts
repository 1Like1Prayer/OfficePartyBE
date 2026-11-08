import test from 'node:test';
import assert from 'node:assert/strict';
import { CUBE_COUNTER } from './constants';
import { difficultyForPuzzle } from './difficulty';
import { findStructureProblem } from './geometry';
import { cubeCounterModule } from './module';
import { parseCubeCounterProgress, parseCubeCounterResult } from './parsing';
import { generatePuzzles, generateScene, type RandomSource } from './sceneGenerator';
import { countBlocks, findSceneProblem } from './sceneValidation';
import { compareScores, scoreResult } from './scoring';
import type { Answer, Box, CubeCounterResult, Puzzle } from './types';

/** Small deterministic generator (mulberry32) so failures are reproducible. */
const seededRandom = (seed: number): RandomSource => {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const box = (x: number, y: number, z: number, width = 1, depth = 1): Box => ({
    x, y, z, width, depth
});

/* ---------------- structure ---------------- */

test('three cubes stacked on one cell are allowed', () => {
    const stack = [box(0, 0, 0), box(0, 0, 1), box(0, 0, 2)];
    assert.equal(findStructureProblem(stack), null);
});

test('a fourth level is rejected', () => {
    const tooTall = [box(0, 0, 0), box(0, 0, 1), box(0, 0, 2), box(0, 0, 3)];
    assert.notEqual(findStructureProblem(tooTall), null);
});

test('footprints up to 3x3 are allowed, 4 wide is not', () => {
    assert.equal(findStructureProblem([box(0, 0, 0, 3, 3)]), null);
    assert.notEqual(findStructureProblem([box(0, 0, 0, 4, 1)]), null);
});

test('boxes must stay inside the 5x5 grid', () => {
    assert.notEqual(findStructureProblem([box(3, 0, 0, 3, 1)]), null);
    assert.notEqual(findStructureProblem([box(-1, 0, 0)]), null);
});

test('overlapping boxes are rejected', () => {
    assert.notEqual(findStructureProblem([box(0, 0, 0, 2, 2), box(1, 1, 0)]), null);
});

test('floating and partly unsupported boxes are rejected', () => {
    assert.notEqual(findStructureProblem([box(2, 2, 1)]), null);
    assert.notEqual(
        findStructureProblem([box(0, 0, 0), box(0, 0, 1, 2, 1)]),
        null
    );
});

/* ---------------- visibility ---------------- */

test('a lone big block is readable', () => {
    assert.equal(findSceneProblem([box(1, 1, 0, 3, 3)]), null);
});

test('a big block with a cube on top is rejected (top must be uncovered)', () => {
    assert.notEqual(findSceneProblem([box(0, 0, 0, 2, 2), box(0, 0, 1)]), null);
});

test('a big block hidden behind a tower is rejected', () => {
    const tower = [box(3, 3, 0), box(3, 3, 1), box(3, 3, 2)];
    const hiddenSlab = box(1, 1, 0, 3, 1);
    assert.notEqual(findSceneProblem([hiddenSlab, ...tower]), null);
});

test('a cube boxed in on its top and both camera-facing sides is rejected', () => {
    const buried = box(0, 0, 0);
    const coveringNeighbours = [box(1, 0, 0), box(0, 1, 0), box(0, 0, 1)];
    assert.notEqual(findSceneProblem([buried, ...coveringNeighbours]), null);
});

test('a cube with an open side is readable', () => {
    assert.equal(findSceneProblem([box(0, 0, 0), box(1, 0, 0)]), null);
});

/* ---------------- generator ---------------- */

test('generated scenes are always valid at every difficulty', () => {
    const count = CUBE_COUNTER.PUZZLES_PER_ROUND;
    for (let seed = 1; seed <= 150; seed++) {
        const random = seededRandom(seed);
        for (let index = 0; index < count; index++) {
            const boxes = generateScene(difficultyForPuzzle(index, count), random);
            assert.equal(findSceneProblem(boxes), null, `seed ${seed}, puzzle ${index}`);
            assert.ok(boxes.length >= 1);
        }
    }
});

test('the first puzzle has no big boxes and one level; the last allows both', () => {
    const count = CUBE_COUNTER.PUZZLES_PER_ROUND;
    const first = difficultyForPuzzle(0, count);
    const last = difficultyForPuzzle(count - 1, count);

    assert.equal(first.maxFootprintSide, 1);
    assert.equal(first.bigBoxChance, 0);
    assert.equal(first.maxStackLevels, 1);
    assert.equal(first.flashMs, CUBE_COUNTER.FLASH_MS);

    assert.equal(last.maxFootprintSide, CUBE_COUNTER.MAX_FOOTPRINT_SIDE);
    assert.equal(last.maxStackLevels, CUBE_COUNTER.MAX_LEVELS);
    assert.equal(last.flashMs, 2_000); // flash time stays 2 s at every level
});

test('most of the round is spent at the hard end of the ramp', () => {
    const count = CUBE_COUNTER.PUZZLES_PER_ROUND;
    const boxCounts = Array.from({ length: count }, (_, i) => difficultyForPuzzle(i, count).boxCount);
    const midpoint = (CUBE_COUNTER.EASIEST_BOX_COUNT + CUBE_COUNTER.HARDEST_BOX_COUNT) / 2;

    assert.deepEqual(boxCounts, [...boxCounts].sort((a, b) => a - b), 'never gets easier');
    assert.ok(boxCounts.filter((n) => n >= midpoint).length > count / 2);
});

test('hard puzzles really do contain big boxes and stacks', () => {
    const hardest = difficultyForPuzzle(CUBE_COUNTER.PUZZLES_PER_ROUND - 1);
    const random = seededRandom(7);
    let sawBigBox = false;
    let sawStack = false;
    for (let i = 0; i < 100; i++) {
        const boxes = generateScene(hardest, random);
        sawBigBox ||= boxes.some((b) => b.width > 1 || b.depth > 1);
        sawStack ||= boxes.some((b) => b.z > 0);
    }
    assert.ok(sawBigBox && sawStack);
});

test('Cube Counter is one scoring round of consecutive puzzles', () => {
    assert.equal(cubeCounterModule.roundsPerGame, 1);
    const round = cubeCounterModule.createRoundData({ roundInGame: 1, roundsPerGame: 1 });
    assert.equal(round.puzzles.length, CUBE_COUNTER.PUZZLES_PER_ROUND);
});

test('puzzles differ in size and composition across the round', () => {
    const { puzzles } = cubeCounterModule.createRoundData({ roundInGame: 1, roundsPerGame: 1 });
    const counts = puzzles.map((puzzle) => puzzle.boxes.length);
    assert.ok(new Set(counts).size > 1);
    assert.ok(counts[counts.length - 1]! > counts[0]!);
});

test('generatePuzzles returns the configured number of puzzles', () => {
    assert.equal(generatePuzzles(seededRandom(3)).length, CUBE_COUNTER.PUZZLES_PER_ROUND);
});

/* ---------------- scoring ---------------- */

const puzzleWithCount = (count: number): Puzzle => ({
    boxes: Array.from({ length: count }, (_, i) => box(i, 0, 0)),
    flashMs: 1_000
});

const resultOf = (answers: Answer[]): CubeCounterResult => ({
    answers,
    timingSuspect: false
});

const puzzles = [puzzleWithCount(3), puzzleWithCount(4)];

const perfectResult = (answerMs: number): CubeCounterResult =>
    resultOf([{ count: 3, answerMs }, { count: 4, answerMs }]);

test('big blocks count once', () => {
    assert.equal(countBlocks([box(0, 0, 0, 3, 3), box(3, 3, 0)]), 2);
});

test('scoring counts correct answers and the time spent on them only', () => {
    const score = scoreResult(
        resultOf([
            { count: 3, answerMs: 1_000 },
            { count: 6, answerMs: 2_000 }
        ]),
        puzzles
    );
    assert.deepEqual(score, { correctCount: 1, correctAnswerMs: 1_000 });
});

test('an unanswered puzzle scores nothing', () => {
    const score = scoreResult(resultOf([
        { count: null, answerMs: 10_000 },
        { count: 4, answerMs: 500 }
    ]), puzzles);
    assert.deepEqual(score, { correctCount: 1, correctAnswerMs: 500 });
});

test('more correct answers beats faster; equal correct is decided by time', () => {
    const base = { correctCount: 2, correctAnswerMs: 5_000 };
    assert.ok(compareScores({ correctCount: 3, correctAnswerMs: 99_000 }, base) < 0);
    assert.ok(compareScores({ ...base, correctAnswerMs: 4_000 }, base) < 0);
    assert.equal(compareScores(base, { ...base }), 0);
});

test('answering fast but wrong never helps', () => {
    const carefulAndRight = scoreResult(perfectResult(5_000), puzzles);
    const fastAndWrong = scoreResult(
        resultOf([{ count: 3, answerMs: 5_000 }, { count: 9, answerMs: 1 }]),
        puzzles
    );
    assert.ok(compareScores(carefulAndRight, fastAndWrong) < 0);
});

/* ---------------- module: ranking, parsing, timeout ---------------- */

const round = { puzzles };
const perfect = resultOf([
    { count: 3, answerMs: 1_000 },
    { count: 4, answerMs: 1_000 }
]);

test('rank orders players and shares rank 1 on an exact tie', () => {
    const ranked = cubeCounterModule.rank(
        [
            { playerId: 'slow', result: resultOf([{ count: 3, answerMs: 2_000 }, { count: 4, answerMs: 2_000 }]) },
            { playerId: 'a', result: perfect },
            { playerId: 'b', result: perfect },
            { playerId: 'wrong', result: resultOf([{ count: 9, answerMs: 1 }, { count: 9, answerMs: 1 }]) }
        ],
        round
    );
    assert.deepEqual(
        ranked.map((row) => [row.playerId, row.rank]),
        [['a', 1], ['b', 1], ['slow', 3], ['wrong', 4]]
    );
});

test('latency cannot change ranking: results are compared as reported', () => {
    const entries = [
        { playerId: 'a', result: perfect },
        { playerId: 'b', result: resultOf([{ count: 3, answerMs: 900 }, { count: 4, answerMs: 900 }]) }
    ];
    // Submission order (arrival time) must not matter.
    const forward = cubeCounterModule.rank(entries, round);
    const reversed = cubeCounterModule.rank([...entries].reverse(), round);
    assert.deepEqual(forward, reversed);
});

test('parseResult accepts a well-formed result and clamps long answer times', () => {
    const parsed = parseCubeCounterResult(
        { answers: [{ count: 3, answerMs: 999_999 }, { count: null, answerMs: 5 }], timingSuspect: true },
        2
    );
    assert.equal(parsed?.answers[0]?.answerMs, CUBE_COUNTER.ANSWER_LIMIT_MS);
    assert.equal(parsed?.answers[1]?.count, null);
    assert.equal(parsed?.timingSuspect, true);
});

test('parseResult rejects malformed input', () => {
    const answer = { count: 3, answerMs: 100 };
    const bad: unknown[] = [
        null,
        'x',
        {},
        { answers: [answer] },
        { answers: [answer, answer, answer] },
        { answers: [answer, { count: 1.5, answerMs: 1 }] },
        { answers: [answer, { count: -1, answerMs: 1 }] },
        { answers: [answer, { count: 999, answerMs: 1 }] },
        { answers: [answer, { count: 2, answerMs: -5 }] },
        { answers: [answer, { count: 2 }] }
    ];
    for (const raw of bad) assert.equal(parseCubeCounterResult(raw, 2), null);
});

test('parseProgress accepts 0..puzzleCount and nothing else', () => {
    assert.deepEqual(parseCubeCounterProgress({ puzzlesDone: 2 }, 6), { puzzlesDone: 2 });
    assert.equal(parseCubeCounterProgress({ puzzlesDone: 7 }, 6), null);
    assert.equal(parseCubeCounterProgress({ puzzlesDone: -1 }, 6), null);
    assert.equal(parseCubeCounterProgress({ puzzlesDone: 1.5 }, 6), null);
    assert.equal(parseCubeCounterProgress({}, 6), null);
});

test('createRoundData sends scenes only, never an answer key', () => {
    const data = cubeCounterModule.createRoundData({ roundInGame: 1, roundsPerGame: 2 });
    assert.deepEqual(Object.keys(data), ['puzzles']);
    for (const puzzle of data.puzzles) {
        assert.deepEqual(Object.keys(puzzle).sort(), ['boxes', 'flashMs']);
    }
});

test('result timeout covers every flash, answer window and pause', () => {
    const timeout = cubeCounterModule.resultTimeoutMs(round);
    const flashes = round.puzzles.reduce((sum, p) => sum + p.flashMs, 0);
    assert.ok(
        timeout >=
            flashes + round.puzzles.length * CUBE_COUNTER.ANSWER_LIMIT_MS
    );
});
