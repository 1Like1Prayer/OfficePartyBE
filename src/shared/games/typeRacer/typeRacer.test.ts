import test from 'node:test';
import assert from 'node:assert/strict';
import type { RandomSource } from '../random';
import { MAX_RACE_MS, TYPE_RACER } from './constants';
import { describeRoll, isSkull, skullsForRoll } from './dice';
import { createTypeRacerModule } from './module';
import { parseRollAction, parseTypeRacerProgress, parseTypeRacerResult } from './parsing';
import {
    charactersTyped,
    checkpointFractions,
    locateOnBar,
    paragraphLength,
    totalCharacters
} from './progress';
import { findLastSurvivor, replayRun, type FaceOfRoll, type PlayerRun } from './replay';
import { createTypeRacerRound } from './roundData';
import { EASY_PARAGRAPHS, HARD_PARAGRAPH_POOL, PARAGRAPH_CATEGORIES } from './texts';
import { isCorrectSoFar, isLineComplete } from './typing';
import type { TypingEvent } from './types';

const seededRandom = (seed: number): RandomSource => {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/* ---------------- dice ---------------- */

test('the dice start with one skull and gain one per survived roll, up to the cap', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map(skullsForRoll), [1, 2, 3, 4, 5, 6, 6]);
    // hearts : skulls  5:1, 4:2, 3:3, 2:4, 1:5, 0:6
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5].map((i) => TYPE_RACER.DICE_SIDES - skullsForRoll(i)),
        [5, 4, 3, 2, 1, 0]
    );
    assert.equal(TYPE_RACER.MAX_SKULLS, TYPE_RACER.DICE_SIDES);
});

test('the sixth roll is all skulls, so every face is deadly', () => {
    for (let face = 1; face <= TYPE_RACER.DICE_SIDES; face++) {
        assert.equal(isSkull(face, 5), true);
    }
    assert.equal(isSkull(6, 4), false); // the fifth roll still has one heart
});

test('skull faces are the lowest faces', () => {
    assert.equal(isSkull(1, 0), true);
    assert.equal(isSkull(2, 0), false);
    assert.equal(isSkull(2, 1), true);
    assert.equal(isSkull(6, 3), false);
    assert.deepEqual(describeRoll(2, 1), { face: 2, skulls: 2, isSkull: true });
});

/* ---------------- typing rules ---------------- */

test('typing is exact: case and punctuation matter, and it must stay a prefix', () => {
    assert.equal(isCorrectSoFar('Hello, world', 'Hello'), true);
    assert.equal(isCorrectSoFar('Hello, world', 'hello'), false);
    assert.equal(isCorrectSoFar('Hello, world', 'Hello world'), false);
    assert.equal(isLineComplete('Hello, world', 'Hello, world'), true);
    assert.equal(isLineComplete('Hello, world', 'Hello, worl'), false);
});

/* ---------------- text pool and round data ---------------- */

test('the pool has 20 paragraphs, all different', () => {
    assert.equal(HARD_PARAGRAPH_POOL.length, 20);
    assert.equal(new Set(HARD_PARAGRAPH_POOL.map((lines) => lines.join('|'))).size, 20);

    const allLines = HARD_PARAGRAPH_POOL.flat();
    assert.equal(new Set(allLines).size, allLines.length, 'no repeated lines');
});

test('there are 5 easy paragraphs: simple words and only commas and full stops', () => {
    assert.equal(EASY_PARAGRAPHS.length, 5);
    assert.equal(new Set(EASY_PARAGRAPHS.map((lines) => lines.join('|'))).size, 5);

    for (const lines of EASY_PARAGRAPHS) {
        assert.ok(lines.length >= 3 && lines.length <= 5);
        for (const line of lines) {
            assert.match(line, /^[A-Za-z][A-Za-z ,.]*$/, line); // no : ' / ! ? - digits or symbols
            assert.equal(line, line.trim());
            assert.ok(line.length >= 20 && line.length <= 62, `${line.length}: ${line}`);
        }
        // Minimal punctuation: at most a couple of marks per paragraph beyond the full stops.
        const commas = lines.join('').split(',').length - 1;
        assert.ok(commas <= 2, `${commas} commas`);
    }
});

test('easy paragraphs use shorter words than hard ones', () => {
    const averageWordLength = (paragraphs: readonly (readonly string[])[]): number => {
        const words = paragraphs.flat().join(' ').split(/\s+/);
        return words.reduce((sum, word) => sum + word.length, 0) / words.length;
    };
    assert.ok(averageWordLength(EASY_PARAGRAPHS) < 5);
    assert.ok(averageWordLength(EASY_PARAGRAPHS) < averageWordLength(HARD_PARAGRAPH_POOL));
});

test('every pooled paragraph is plain ASCII, tidy and a sensible size', () => {
    for (const lines of HARD_PARAGRAPH_POOL) {
        assert.ok(lines.length >= 3 && lines.length <= 5);
        for (const line of lines) {
            assert.match(line, /^[\x20-\x7e]+$/, line);
            assert.equal(line, line.trim());
            assert.ok(line.length >= 20 && line.length <= 62, `${line.length}: ${line}`);
        }
    }
});

test('the pool uses every promised punctuation mark', () => {
    const text = HARD_PARAGRAPH_POOL.flat().join('');
    for (const mark of [',', '.', '!', '?', ':', '-', "'"]) {
        assert.ok(text.includes(mark), `missing ${mark}`);
    }
});

test('the pool mixes field notes, alphabets, word salad and text with no spaces', () => {
    const firstLines = HARD_PARAGRAPH_POOL.map((lines) => lines[0]!);
    const fieldNotes = firstLines.filter((line) => /^(Specimen ID|Field log):/.test(line));
    const alphabets = firstLines.filter((line) => line.startsWith('A - ') || line.startsWith('Z - '));
    const noSpaces = HARD_PARAGRAPH_POOL.filter((lines) => lines.every((line) => !line.includes(' ')));

    assert.ok(fieldNotes.length >= 3, 'field notes');
    assert.ok(alphabets.length >= 3, 'alphabets');
    assert.ok(noSpaces.length >= 3, 'no-space paragraphs');
});

const typeRacerForSameSeed = (playerIds: string[]) =>
    createTypeRacerModule(stubFaceForSeedTest, seededRandom(42)).createRoundData({
        roundInGame: 1,
        roundsPerGame: 2,
        playerIds,
        attempt: 0
    });
const stubFaceForSeedTest = () => 6;

const categoryOf = (lines: readonly string[]): string =>
    PARAGRAPH_CATEGORIES.find((category) =>
        category.paragraphs.some((paragraph) => paragraph.join('|') === lines.join('|'))
    )!.name;

const EASY_KEYS = new Set(EASY_PARAGRAPHS.map((lines) => lines.join('|')));
const isEasy = (lines: readonly string[]): boolean => EASY_KEYS.has(lines.join('|'));

/** Splits a round into its warm-up and its hard part. */
const split = (paragraphs: readonly (readonly string[])[]) => ({
    easy: paragraphs.filter(isEasy),
    hard: paragraphs.filter((lines) => !isEasy(lines))
});

test('a round is 1 or 2 easy paragraphs first, then 3 hard ones', () => {
    const easyCounts = new Set<number>();
    for (let seed = 1; seed <= 300; seed++) {
        const { paragraphs } = createTypeRacerRound(seededRandom(seed));
        const { easy, hard } = split(paragraphs);

        easyCounts.add(easy.length);
        assert.ok(easy.length >= 1 && easy.length <= 2, `seed ${seed}`);
        assert.equal(hard.length, 3, `seed ${seed}`);
        // The easy ones come first, then the hard ones.
        assert.deepEqual(paragraphs.slice(0, easy.length), easy);
        assert.deepEqual(paragraphs.slice(easy.length), hard);
    }
    assert.deepEqual([...easyCounts].sort(), [1, 2]);
});

test('the hard paragraphs come from three different categories', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const { hard } = split(createTypeRacerRound(seededRandom(seed)).paragraphs);
        const categories = hard.map(categoryOf);
        assert.equal(new Set(categories).size, 3, `seed ${seed}: ${categories}`);
    }
});

test('over many rounds every category, every hard paragraph and every easy paragraph gets picked', () => {
    const categoryCounts = new Map<string, number>();
    const seenHard = new Set<string>();
    const seenEasy = new Set<string>();
    for (let seed = 1; seed <= 600; seed++) {
        const { easy, hard } = split(createTypeRacerRound(seededRandom(seed)).paragraphs);
        for (const lines of easy) seenEasy.add(lines.join('|'));
        for (const lines of hard) {
            seenHard.add(lines.join('|'));
            categoryCounts.set(categoryOf(lines), (categoryCounts.get(categoryOf(lines)) ?? 0) + 1);
        }
    }
    assert.equal(categoryCounts.size, PARAGRAPH_CATEGORIES.length);
    assert.equal(seenHard.size, HARD_PARAGRAPH_POOL.length);
    assert.equal(seenEasy.size, EASY_PARAGRAPHS.length);
    // No category is starved: each shows up in at least half of an even share of the picks.
    const total = [...categoryCounts.values()].reduce((a, b) => a + b, 0);
    for (const count of categoryCounts.values()) {
        assert.ok(count > total / PARAGRAPH_CATEGORIES.length / 2);
    }
});

test('the order is properly shuffled: any category can come first or last among the hard ones', () => {
    const first = new Set<string>();
    const last = new Set<string>();
    const firstEasy = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
        const { easy, hard } = split(createTypeRacerRound(seededRandom(seed)).paragraphs);
        first.add(categoryOf(hard[0]!));
        last.add(categoryOf(hard[hard.length - 1]!));
        firstEasy.add(easy[0]!.join('|'));
    }
    assert.equal(first.size, PARAGRAPH_CATEGORIES.length);
    assert.equal(last.size, PARAGRAPH_CATEGORIES.length);
    assert.equal(firstEasy.size, EASY_PARAGRAPHS.length); // the warm-up isn't always the same text
});

test('the position of each category within the hard part is evenly spread', () => {
    // How often is each category the first hard paragraph? Roughly 3 in 6 rounds include it, 1 in 3 of those first.
    const asFirst = new Map<string, number>();
    const rounds = 3_000;
    for (let seed = 1; seed <= rounds; seed++) {
        const { hard } = split(createTypeRacerRound(seededRandom(seed)).paragraphs);
        const name = categoryOf(hard[0]!);
        asFirst.set(name, (asFirst.get(name) ?? 0) + 1);
    }
    const expected = rounds / PARAGRAPH_CATEGORIES.length;
    for (const count of asFirst.values()) {
        assert.ok(Math.abs(count - expected) < expected * 0.2, [...asFirst].join());
    }
});

test('the paragraphs do not depend on which players are in the race', () => {
    const forTwo = typeRacerForSameSeed(['a', 'b']);
    const forEight = typeRacerForSameSeed(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    assert.deepEqual(forTwo, forEight);
});

test('a round has 4 or 5 different paragraphs, and both counts occur', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 200; seed++) {
        const round = createTypeRacerRound(seededRandom(seed));
        counts.add(round.paragraphs.length);
        assert.ok(round.paragraphs.length >= 4 && round.paragraphs.length <= 5);
        assert.equal(new Set(round.paragraphs.map((p) => p.join('|'))).size, round.paragraphs.length);
        assert.match(round.rollNonce, /^[0-9a-f]{24}$/);
    }
    assert.deepEqual([...counts].sort(), [4, 5]);
});

/* ---------------- replay ---------------- */

// 4 paragraphs of 2 lines. Lines are 5 characters long, so progress is easy to count.
const RACE_TEXT = [0, 1, 2, 3].map(() => ['aaaaa', 'bbbbb']);
const SAFE: FaceOfRoll = () => 6; // always a heart
const DEADLY: FaceOfRoll = () => 1; // always a skull
const DEADLY_AFTER_FIRST: FaceOfRoll = (rollIndex) => (rollIndex === 0 ? 6 : 1);

const mistakes = (count: number, atMs: number): TypingEvent[] =>
    Array.from({ length: count }, (_, i) => ({ kind: 'mistake' as const, atMs: atMs + i }));
const PAUSE = TYPE_RACER.PARAGRAPH_PAUSE_MS;
const LINES_PER_PARAGRAPH = 2;

/**
 * Finished lines, one every `stepMs`, starting at `startMs`. The race text has
 * two lines per paragraph, and typing is closed for the pause after each
 * finished paragraph, so the lines after it come that much later.
 */
const lines = (count: number, startMs: number, stepMs = 1_000): TypingEvent[] =>
    Array.from({ length: count }, (_, i) => ({
        kind: 'line' as const,
        atMs: startMs + i * stepMs + Math.floor(i / LINES_PER_PARAGRAPH) * PAUSE
    }));

const replay = (events: TypingEvent[], faceOfRoll: FaceOfRoll = SAFE, endedAtMs?: number) =>
    replayRun(events, endedAtMs ?? events[events.length - 1]?.atMs ?? 0, RACE_TEXT, faceOfRoll);

test('finishing every line of every paragraph wins the race, at the last line time', () => {
    const run = replay(lines(8, 1_000));
    assert.equal(run.status, 'finished');
    assert.equal(run.endedAtMs, 8_000 + 3 * PAUSE); // three pauses, none after the last paragraph
    assert.equal(run.paragraphsDone, 4);
    assert.equal(run.linesDone, 8);
});

test('two mistakes are free; the third casts the dice', () => {
    const twoMistakes = replay([...mistakes(2, 100), ...lines(1, 500)], DEADLY);
    assert.notEqual(twoMistakes.status, 'eliminated');
    assert.equal(twoMistakes.rollsCast, 0);

    const third = replay(mistakes(3, 100), DEADLY);
    assert.equal(third.status, 'eliminated');
    assert.equal(third.cause, 'skull');
    assert.equal(third.endedAtMs, 102);
});

test('surviving the dice drops you back to two strikes: one more mistake rolls again', () => {
    // 3 mistakes -> survive (roll 0). The very next mistake is strike 3 again -> roll 1.
    const faces = [6, 1]; // roll 0 safe, roll 1 skull (skulls = 2, face 1 is a skull)
    const run = replay(mistakes(4, 100), (i) => faces[i]!);
    assert.equal(run.status, 'eliminated');
    assert.equal(run.rollsCast, 1); // one roll survived before the fatal one
    assert.equal(run.endedAtMs, 103);
});

test('finishing the paragraph after a survived roll clears the strikes', () => {
    // 3 mistakes (survive, back to 2 strikes), finish paragraph 1, then only 2 mistakes in
    // paragraph 2: strikes started again from 0, so no second roll is cast.
    const run = replay([...mistakes(3, 100), ...lines(2, 1_000), ...mistakes(2, 10_000)], DEADLY_AFTER_FIRST);
    assert.equal(run.rollsCast, 1);
    assert.notEqual(run.status, 'eliminated');
});

test('finishing a paragraph resets strikes to 0 but not the skull count', () => {
    // Roll 0 (1 skull): face 2 is a heart. Roll 1 (2 skulls): face 2 is a skull.
    const faces = [2, 2];
    const events = [
        ...mistakes(3, 100), // roll 0: survives
        ...lines(2, 1_000), // paragraph 1 done, strikes reset
        ...mistakes(3, 10_000) // roll 1 (after the pause): now 2 skulls, face 2 is a skull
    ];
    const run = replay(events, (i) => faces[i]!);
    assert.equal(run.status, 'eliminated');
    assert.equal(run.cause, 'skull');
    assert.equal(run.paragraphsDone, 1);
});

test('events after elimination are ignored', () => {
    const run = replay([...mistakes(3, 100), ...lines(8, 1_000)], DEADLY);
    assert.equal(run.status, 'eliminated');
    assert.equal(run.linesDone, 0);
});

test('a paragraph not finished within 3 minutes eliminates the player', () => {
    const limit = TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS;
    // Paragraph 1 finishes in time; the next line event for paragraph 2 comes too late.
    const paragraphTwoOpensAt = 11_000 + PAUSE;
    const run = replay([...lines(2, 10_000), { kind: 'line', atMs: paragraphTwoOpensAt + limit + 5_000 }]);
    assert.equal(run.status, 'eliminated');
    assert.equal(run.cause, 'time');
    assert.equal(run.endedAtMs, paragraphTwoOpensAt + limit); // the counter starts after the pause
});

test('the 3-minute counter restarts for each paragraph', () => {
    const limit = TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS;
    // Each paragraph takes nearly the full limit; the race still finishes.
    const events: TypingEvent[] = [];
    let paragraphOpensAt = 0;
    for (let paragraph = 0; paragraph < 4; paragraph++) {
        events.push({ kind: 'line', atMs: paragraphOpensAt + limit - 2_000 });
        events.push({ kind: 'line', atMs: paragraphOpensAt + limit - 1_000 });
        paragraphOpensAt += limit - 1_000 + PAUSE;
    }
    assert.equal(replay(events).status, 'finished');
});

test('a client that stops after the deadline without finishing is eliminated for time', () => {
    const run = replay([], SAFE, TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS + 1);
    assert.equal(run.status, 'eliminated');
    assert.equal(run.cause, 'time');
});

test('typing is closed during the 7-second pause: presses in it are ignored', () => {
    assert.equal(PAUSE, 7_000);
    const events: TypingEvent[] = [
        { kind: 'line', atMs: 1_000 },
        { kind: 'line', atMs: 2_000 }, // paragraph 1 done; the pause runs until 9,000
        { kind: 'line', atMs: 5_000 }, // in the pause: ignored
        ...mistakes(3, 6_000), // in the pause: ignored, so no dice are cast
        { kind: 'line', atMs: 10_000 },
        { kind: 'line', atMs: 11_000 }
    ];
    const run = replay(events, DEADLY, 12_000);
    assert.equal(run.status, 'unfinished');
    assert.equal(run.paragraphsDone, 2);
    assert.equal(run.linesDone, 4);
    assert.equal(run.rollsCast, 0);
});

test('the paragraph time limit starts when the pause ends, not when the paragraph is finished', () => {
    const limit = TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS;
    // Paragraph 1 done at 2,000, so paragraph 2 opens at 2,000 + pause.
    const justInTime = { kind: 'line' as const, atMs: 2_000 + PAUSE + limit };
    const tooLate = { kind: 'line' as const, atMs: 2_000 + PAUSE + limit + 1 };
    const base = lines(2, 1_000);

    assert.notEqual(replay([...base, justInTime]).status, 'eliminated');
    assert.equal(replay([...base, tooLate]).cause, 'time');
});

test('there is no pause after the last paragraph: finishing counts at once', () => {
    const run = replay(lines(8, 1_000));
    const lastLineAt = lines(8, 1_000)[7]!.atMs;
    assert.equal(run.endedAtMs, lastLineAt);
});

test('a client that stops early without finishing is simply unfinished', () => {
    const run = replay(lines(3, 1_000), SAFE, 20_000);
    assert.equal(run.status, 'unfinished');
    assert.equal(run.paragraphsDone, 1);
    assert.equal(run.linesDone, 3);
});

/* ---------------- last survivor ---------------- */

const runEnding = (status: PlayerRun['status'], endedAtMs: number): PlayerRun => ({
    status,
    endedAtMs,
    paragraphsDone: 0,
    linesDone: 0,
    charsDone: 0,
    rollsCast: 0,
    cause: status === 'eliminated' ? 'skull' : null
});

test('the last player standing is the survivor, from the moment the last other one falls', () => {
    const result = findLastSurvivor([
        { playerId: 'a', run: runEnding('eliminated', 5_000) },
        { playerId: 'b', run: runEnding('eliminated', 9_000) },
        { playerId: 'c', run: runEnding('unfinished', 20_000) }
    ]);
    assert.deepEqual(result, { playerId: 'c', wonAtMs: 9_000 });
});

test('there is no last survivor while two players are still standing', () => {
    assert.equal(
        findLastSurvivor([
            { playerId: 'a', run: runEnding('eliminated', 5_000) },
            { playerId: 'b', run: runEnding('unfinished', 9_000) },
            { playerId: 'c', run: runEnding('finished', 20_000) }
        ]),
        null
    );
});

test('there is no last survivor if the last two fall at the same instant', () => {
    assert.equal(
        findLastSurvivor([
            { playerId: 'a', run: runEnding('eliminated', 5_000) },
            { playerId: 'b', run: runEnding('eliminated', 9_000) },
            { playerId: 'c', run: runEnding('eliminated', 9_000) }
        ]),
        null
    );
    assert.equal(
        findLastSurvivor([
            { playerId: 'a', run: runEnding('eliminated', 7_000) },
            { playerId: 'b', run: runEnding('eliminated', 7_000) }
        ]),
        null
    );
});

test('whoever falls last still wins if the others fell first, even if they would have fallen later', () => {
    // 'a' falls at 5,000 and the race is over: 'b' was the only one left, so 'b' wins.
    assert.deepEqual(
        findLastSurvivor([
            { playerId: 'a', run: runEnding('eliminated', 5_000) },
            { playerId: 'b', run: runEnding('eliminated', 9_000) }
        ]),
        { playerId: 'b', wonAtMs: 5_000 }
    );
});

test('a lone reporter is not a "last survivor"', () => {
    assert.equal(findLastSurvivor([{ playerId: 'a', run: runEnding('unfinished', 100) }]), null);
});

/* ---------------- parsing ---------------- */

test('parseResult accepts a well-formed report', () => {
    const parsed = parseTypeRacerResult({
        events: [{ kind: 'mistake', atMs: 10.4 }, { kind: 'line', atMs: 20 }],
        endedAtMs: 30,
        timingSuspect: true
    });
    assert.deepEqual(parsed?.events, [{ kind: 'mistake', atMs: 10 }, { kind: 'line', atMs: 20 }]);
    assert.equal(parsed?.timingSuspect, true);
});

test('parseResult rejects malformed reports', () => {
    const ok = { kind: 'line', atMs: 10 };
    const bad: unknown[] = [
        null,
        {},
        { events: 'x', endedAtMs: 1 },
        { events: [{ kind: 'jump', atMs: 1 }], endedAtMs: 1 },
        { events: [{ kind: 'line', atMs: -1 }], endedAtMs: 1 },
        { events: [{ kind: 'line', atMs: MAX_RACE_MS + 1 }], endedAtMs: 1 },
        { events: [ok, { kind: 'line', atMs: 5 }], endedAtMs: 50 }, // goes backwards
        { events: [ok], endedAtMs: 5 }, // ended before its last event
        { events: [ok] }, // no end time
        { events: Array(TYPE_RACER.MAX_EVENTS + 1).fill(ok), endedAtMs: 10 }
    ];
    for (const raw of bad) assert.equal(parseTypeRacerResult(raw), null);
});

const textRound = { paragraphs: RACE_TEXT, rollNonce: 'n' };

test('parseProgress accepts a report inside the race and rejects anything outside it', () => {
    const good = { chars: 12, paragraph: 1, strikes: 2, skulls: 1, status: 0 };
    assert.deepEqual(parseTypeRacerProgress(good, textRound), good);

    // The race has 4 paragraphs x 10 characters = 40 characters.
    assert.notEqual(parseTypeRacerProgress({ ...good, chars: 40 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, chars: 41 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, chars: -1 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, chars: 1.5 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, paragraph: 5 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, strikes: 4 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ ...good, status: 3 }, textRound), null);
    assert.equal(parseTypeRacerProgress({ chars: 1 }, textRound), null);
});

test('parseRollAction bounds its input', () => {
    assert.deepEqual(parseRollAction({ type: 'roll', rollIndex: 0 }), { type: 'roll', rollIndex: 0 });
    assert.equal(parseRollAction({ type: 'roll', rollIndex: -1 }), null);
    assert.equal(parseRollAction({ type: 'roll', rollIndex: 1.5 }), null);
    assert.equal(parseRollAction({ type: 'roll', rollIndex: TYPE_RACER.MAX_ROLL_INDEX + 1 }), null);
    assert.equal(parseRollAction({ type: 'cast' }), null);
});

/* ---------------- progress bar ---------------- */

// Paragraphs of different lengths: 20, 40 and 10 characters.
const BAR_TEXT = [['aaaaaaaaaa', 'bbbbbbbbbb'], ['c'.repeat(20), 'd'.repeat(20)], ['e'.repeat(10)]];

test('paragraph and race lengths count characters', () => {
    assert.deepEqual(BAR_TEXT.map(paragraphLength), [20, 40, 10]);
    assert.equal(totalCharacters(BAR_TEXT), 70);
});

test('characters typed = finished paragraphs + finished lines + the current line so far', () => {
    assert.equal(charactersTyped(BAR_TEXT, { paragraphIndex: 0, lineIndex: 0, typedInLine: 0 }), 0);
    assert.equal(charactersTyped(BAR_TEXT, { paragraphIndex: 0, lineIndex: 1, typedInLine: 4 }), 14);
    assert.equal(charactersTyped(BAR_TEXT, { paragraphIndex: 1, lineIndex: 1, typedInLine: 5 }), 45);
    assert.equal(charactersTyped(BAR_TEXT, { paragraphIndex: 3, lineIndex: 0, typedInLine: 0 }), 70);
});

test('the bar is as wide as the text: every character takes the same width', () => {
    // Halfway through the 20-character first paragraph = 10 of 70 characters.
    const first = locateOnBar(BAR_TEXT, 10);
    assert.equal(first.paragraphIndex, 0);
    assert.equal(first.fractionOfSection, 0.5);
    assert.equal(first.fractionOfBar, 10 / 70);

    // 10 characters into the 40-character second paragraph (20 + 10 = 30 typed).
    const second = locateOnBar(BAR_TEXT, 30);
    assert.equal(second.paragraphIndex, 1);
    assert.equal(second.fractionOfSection, 0.25);
    assert.equal(second.fractionOfBar, 30 / 70);
});

test('a shorter paragraph puts its checkpoint earlier on the bar', () => {
    // 20, 40 and 10 characters: checkpoints at 20/70, 60/70 and the end.
    assert.deepEqual(checkpointFractions(BAR_TEXT), [20 / 70, 60 / 70, 1]);

    const short = [['a'.repeat(10)], ['b'.repeat(30)]];
    const long = [['a'.repeat(30)], ['b'.repeat(10)]];
    assert.ok(checkpointFractions(short)[0]! < checkpointFractions(long)[0]!);
    assert.equal(checkpointFractions(short)[0], 0.25);
    assert.equal(checkpointFractions(long)[0], 0.75);
});

test('a completed paragraph lands exactly on its checkpoint, and the end is 100%', () => {
    const checkpoints = checkpointFractions(BAR_TEXT);
    assert.equal(locateOnBar(BAR_TEXT, 20).fractionOfBar, checkpoints[0]);
    assert.equal(locateOnBar(BAR_TEXT, 60).fractionOfBar, checkpoints[1]);
    assert.equal(locateOnBar(BAR_TEXT, 70).fractionOfBar, 1);
    assert.equal(locateOnBar(BAR_TEXT, 999).fractionOfBar, 1);
    assert.equal(locateOnBar(BAR_TEXT, 0).fractionOfBar, 0);
    assert.equal(locateOnBar(BAR_TEXT, -5).fractionOfBar, 0);
});

test('a mistake steps the marker back to the start of the line', () => {
    const beforeMistake = charactersTyped(BAR_TEXT, { paragraphIndex: 1, lineIndex: 1, typedInLine: 17 });
    const afterMistake = charactersTyped(BAR_TEXT, { paragraphIndex: 1, lineIndex: 1, typedInLine: 0 });
    assert.equal(beforeMistake - afterMistake, 17);
    assert.ok(locateOnBar(BAR_TEXT, afterMistake).fractionOfBar < locateOnBar(BAR_TEXT, beforeMistake).fractionOfBar);
});

test('there is one checkpoint per paragraph, in increasing order', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const { paragraphs } = createTypeRacerRound(seededRandom(seed));
        const checkpoints = checkpointFractions(paragraphs);
        assert.equal(checkpoints.length, paragraphs.length);
        assert.equal(checkpoints[checkpoints.length - 1], 1);
        assert.deepEqual(checkpoints, [...checkpoints].sort((a, b) => a - b));
    }
});

test('the replay counts characters so the final result agrees with the bar', () => {
    const run = replay([...lines(3, 1_000)], SAFE, 5_000);
    assert.equal(run.linesDone, 3);
    assert.equal(run.charsDone, 15); // three 5-character lines
    assert.equal(locateOnBar(RACE_TEXT, run.charsDone).paragraphIndex, 1);
});

/* ---------------- module ---------------- */

/** A stand-in die: face depends on player and roll, like the real one, but is deterministic. */
const stubFace = (_nonce: string, playerId: string, rollIndex: number): number =>
    playerId.startsWith('unlucky') ? 1 : (rollIndex % 5) + 2; // 2..6: hearts for roll 0

const typeRacer = createTypeRacerModule(stubFace, seededRandom(3));
const round = { paragraphs: [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']], rollNonce: 'n' };
const resultOf = (events: TypingEvent[], endedAtMs = events[events.length - 1]?.atMs ?? 0) => ({
    events,
    endedAtMs,
    timingSuspect: false
});

test('Type Racer Roulette is a self-timed game with 2 scoring rounds', () => {
    assert.equal(typeRacer.kind, 'self-timed');
    assert.equal(typeRacer.roundsPerGame, 2);
});

test('the end of a race gets 5 seconds for the celebration animation', () => {
    assert.equal(typeRacer.finishAnimationMs, 5_000);
});

test('rank: the first to finish wins, ahead of anyone eliminated or unfinished', () => {
    const ranked = typeRacer.rank(
        [
            { playerId: 'slow', result: resultOf(lines(8, 2_000)) },
            { playerId: 'fast', result: resultOf(lines(8, 1_000)) },
            { playerId: 'unlucky', result: resultOf(mistakes(3, 100)) },
            { playerId: 'stopped', result: resultOf(lines(3, 500), 9_000) }
        ],
        round
    );
    assert.deepEqual(
        ranked.map((row) => [row.playerId, row.rank]),
        [['fast', 1], ['slow', 2], ['stopped', 3], ['unlucky', 4]]
    );
    assert.equal(ranked[3]!.detail.eliminatedBy, 'skull');
});

test('rank: when every other player has been knocked out, the survivor wins without finishing', () => {
    // 'unlucky' dies to a skull at 102. 'unlucky2' gets much further (three paragraphs)
    // before dying too. 'brave' only got through 1 line but is the only one still standing.
    const ranked = typeRacer.rank(
        [
            { playerId: 'unlucky', result: resultOf(mistakes(3, 100)) },
            { playerId: 'unlucky2', result: resultOf([...lines(6, 500), ...mistakes(3, 30_000)]) },
            { playerId: 'brave', result: resultOf(lines(1, 1_000), 8_000) }
        ],
        round
    );
    assert.equal(ranked[0]!.playerId, 'brave');
    assert.equal(ranked[0]!.rank, 1);
    assert.equal(ranked[0]!.detail.lastSurvivor, true);
    assert.equal(ranked[1]!.rank, 2);
    assert.ok(ranked.slice(1).every((row) => row.detail.lastSurvivor === false));
});

test('rank: nothing the survivor does after the others fall counts against them', () => {
    // 'late' would be knocked out by a skull at 20,000 ms, but the others were
    // already all out by 5,000 ms, so the race was over and 'late' had won.
    const ranked = typeRacer.rank(
        [
            { playerId: 'unlucky', result: resultOf(mistakes(3, 100)) },
            { playerId: 'unlucky2', result: resultOf(mistakes(3, 5_000)) },
            { playerId: 'unlucky3', result: resultOf(mistakes(3, 5_000)) },
            { playerId: 'lucky', result: resultOf(mistakes(3, 20_000)) }
        ],
        round
    );
    // 'lucky' (not prefixed 'unlucky') rolls hearts in the stub, so is never knocked out.
    assert.equal(ranked[0]!.playerId, 'lucky');
    assert.equal(ranked[0]!.detail.lastSurvivor, true);
});

test('rank: a survivor who finishes first still just wins', () => {
    const ranked = typeRacer.rank(
        [
            { playerId: 'unlucky', result: resultOf(mistakes(3, 100)) },
            { playerId: 'fast', result: resultOf(lines(8, 1_000)) }
        ],
        round
    );
    assert.equal(ranked[0]!.playerId, 'fast');
});

test('rank: if nobody finishes, whoever got furthest is best', () => {
    const ranked = typeRacer.rank(
        [
            { playerId: 'a', result: resultOf(lines(2, 1_000), 5_000) },
            { playerId: 'b', result: resultOf(lines(5, 1_000), 5_000) }
        ],
        round
    );
    assert.equal(ranked[0]!.playerId, 'b');
});

test('rank: finishing at the same millisecond is a genuine tie', () => {
    const ranked = typeRacer.rank(
        [
            { playerId: 'a', result: resultOf(lines(8, 1_000)) },
            { playerId: 'b', result: resultOf(lines(8, 1_000)) }
        ],
        round
    );
    assert.deepEqual(ranked.map((row) => row.rank), [1, 1]);
});

test('rank ignores the order results arrived in (latency cannot change the winner)', () => {
    const entries = [
        { playerId: 'a', result: resultOf(lines(8, 1_000)) },
        { playerId: 'b', result: resultOf(lines(8, 1_500)) }
    ];
    assert.deepEqual(typeRacer.rank(entries, round), typeRacer.rank([...entries].reverse(), round));
});

test('handleAction returns the same roll the replay will use', () => {
    const reply = typeRacer.handleAction!(round, 'unlucky', { type: 'roll', rollIndex: 0 });
    assert.deepEqual(reply, { face: 1, skulls: 1, isSkull: true });

    const ranked = typeRacer.rank([{ playerId: 'unlucky', result: resultOf(mistakes(3, 100)) }], round);
    assert.equal(ranked[0]!.detail.eliminatedBy, 'skull'); // the replay agrees with what the player was told
});

test('handleAction rejects malformed requests', () => {
    assert.equal(typeRacer.handleAction!(round, 'a', { type: 'roll' }), null);
    assert.equal(typeRacer.handleAction!(round, 'a', 'roll'), null);
});

test('result timeout covers every paragraph running to its limit', () => {
    assert.ok(
        typeRacer.resultTimeoutMs(round) >= round.paragraphs.length * TYPE_RACER.PARAGRAPH_TIME_LIMIT_MS
    );
});
