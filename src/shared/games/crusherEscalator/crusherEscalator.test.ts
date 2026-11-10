import test from 'node:test';
import assert from 'node:assert/strict';
import type { RandomSource } from '../random';
import { CRUSHER_ESCALATOR, DIRECTIONS } from './constants';
import { crusherEscalatorModule } from './module';
import { parseCrusherEscalatorProgress, parseCrusherEscalatorResult } from './parsing';
import { simulateRace, type RaceRules, type Racer } from './race';
import { splitIntoTwoGroups } from './groups';
import { directionAt, generatePlayerStreams, generateStream } from './stream';
import type { ArrowStream, Direction, Input } from './types';

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

const GAP = CRUSHER_ESCALATOR.ELIMINATION_GAP;

/* ---------------- streams ---------------- */

const hasNoRepeatsIncludingWrap = (stream: ArrowStream): boolean =>
    stream.every((direction, i) => direction !== stream[(i + 1) % stream.length]);

test('a stream has 30 symbols and never repeats a direction, even at the loop point', () => {
    for (let seed = 1; seed <= 300; seed++) {
        const stream = generateStream(seededRandom(seed));
        assert.equal(stream.length, CRUSHER_ESCALATOR.STREAM_LENGTH);
        assert.ok(hasNoRepeatsIncludingWrap(stream), `seed ${seed}`);
        assert.ok(stream.every((d) => (DIRECTIONS as readonly string[]).includes(d)));
    }
});

test('a stream uses all four directions over its length', () => {
    const stream = generateStream(seededRandom(5));
    assert.equal(new Set(stream).size, 4);
});

test('every player gets a different stream', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (let seed = 1; seed <= 50; seed++) {
        const streams = generatePlayerStreams(ids, seededRandom(seed));
        assert.deepEqual(Object.keys(streams), ids);
        assert.equal(new Set(Object.values(streams).map((s) => s.join())).size, ids.length);
    }
});

test('the stream loops: press 30 shows the first symbol again', () => {
    const stream = generateStream(seededRandom(9));
    assert.equal(directionAt(stream, 0), stream[0]);
    assert.equal(directionAt(stream, 30), stream[0]);
    assert.equal(directionAt(stream, 31), stream[1]);
});

/* ---------------- race ---------------- */

const STREAM: Direction[] = ['up', 'down', 'left', 'right'];

const wrongFor = (direction: Direction): Direction =>
    DIRECTIONS.find((d) => d !== direction)!;

/** `count` presses, one every `stepMs`, each right or wrong as chosen. */
const presses = (
    count: number,
    stepMs: number,
    isRight: (pressIndex: number) => boolean = () => true,
    startMs = 0
): Input[] =>
    Array.from({ length: count }, (_, i) => {
        const shown = directionAt(STREAM, i);
        return {
            direction: isRight(i) ? shown : wrongFor(shown),
            atMs: startMs + (i + 1) * stepMs
        };
    });

const FINAL: RaceRules = { survivorsToEnd: 1 };

/** A race with everyone in one group, ending when one player is left. */
const raceOf = (racers: Racer[], rules: RaceRules = FINAL) => simulateRace(racers, rules);

const racer = (playerId: string, inputs: Input[], groupId = 'main'): Racer => ({
    playerId,
    groupId,
    inputs,
    stream: STREAM
});

const outcomeOf = (outcomes: ReturnType<typeof simulateRace>, playerId: string) =>
    outcomes.find((o) => o.playerId === playerId)!;

test('everyone starts on 0 and a correct press is worth 1, a wrong press 0', () => {
    const [outcome] = raceOf([
        racer('a', presses(4, 100, (i) => i % 2 === 0)),
        racer('b', [])
    ]);
    // presses 0 and 2 are right; 1 and 3 are wrong.
    assert.equal(outcome!.score, 2);
    assert.equal(raceOf([racer('x', [])])[0]!.score, 0);
});

test('the arrow advances on a wrong press too', () => {
    // Press 0 is wrong. Press 1 is the right arrow for position 1, so scores.
    const inputs: Input[] = [
        { direction: wrongFor(STREAM[0]!), atMs: 10 },
        { direction: STREAM[1]!, atMs: 20 }
    ];
    assert.equal(raceOf([racer('a', inputs), racer('b', [])])[0]!.score, 1);
});

test('a player GAP points behind the leader is crushed, at that moment', () => {
    // 'a' scores every 100 ms; 'b' never scores. 'b' falls GAP behind when a hits GAP.
    const outcomes = raceOf([
        racer('a', presses(20, 100)),
        racer('b', presses(20, 100, () => false))
    ]);
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, GAP * 100);
    assert.equal(outcomeOf(outcomes, 'b').score, 0);
});

test('one point short of the gap is still alive', () => {
    const outcomes = raceOf([
        racer('a', presses(GAP - 1, 100)),
        racer('b', [])
    ]);
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, null);
});

test('the race ends when one player is left, so later presses are ignored', () => {
    const outcomes = raceOf([
        racer('a', presses(30, 100)),
        racer('b', [])
    ]);
    // b is crushed at 800 ms; a's later presses must not add to the score.
    assert.equal(outcomeOf(outcomes, 'a').score, GAP);
    assert.equal(outcomeOf(outcomes, 'a').eliminatedAtMs, null);
});

test('an eliminated player stops scoring', () => {
    const outcomes = raceOf([
        racer('a', presses(30, 100)),
        racer('b', presses(30, 100, () => false)),
        racer('c', presses(30, 100, (i) => i < 5, 0)) // 5 right, then wrong
    ]);
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, GAP * 100);
    // c stalls on 5 points, so it is crushed once a reaches 5 + GAP.
    assert.equal(outcomeOf(outcomes, 'c').score, 5);
    assert.equal(outcomeOf(outcomes, 'c').eliminatedAtMs, (5 + GAP) * 100);
});

test('the leader is whoever has the highest score, and the lead can change hands', () => {
    // a leads early then stalls; b overtakes. c, stuck on 2, falls GAP behind b.
    const outcomes = raceOf([
        racer('a', presses(4, 100)),
        racer('b', presses(20, 100, (i) => i >= 0, 500)),
        racer('c', presses(2, 100))
    ]);
    assert.equal(outcomeOf(outcomes, 'c').eliminatedAtMs !== null, true);
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, null);
});

test('simultaneous presses are all counted before anyone is crushed', () => {
    // Both reach the gap over c at the same instant; neither order matters.
    const outcomes = raceOf([
        racer('a', presses(GAP, 100)),
        racer('b', presses(GAP, 100)),
        racer('c', [])
    ]);
    const forward = outcomeOf(outcomes, 'c');
    const reversed = outcomeOf(
        raceOf([racer('c', []), racer('b', presses(GAP, 100)), racer('a', presses(GAP, 100))]),
        'c'
    );
    assert.equal(forward.eliminatedAtMs, GAP * 100);
    assert.deepEqual(forward, reversed);
    // a and b are level on the lead, so both survive.
    assert.equal(outcomeOf(outcomes, 'a').eliminatedAtMs, null);
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, null);
});

test('a lone reporter survives with their own score', () => {
    const outcomes = raceOf([racer('solo', presses(3, 100))]);
    assert.equal(outcomes[0]!.eliminatedAtMs, null);
});

/* ---------------- module: round data, ranking, parsing ---------------- */

test('round data gives each player their own stream', () => {
    const round = crusherEscalatorModule.createRoundData({
        roundInGame: 1,
        roundsPerGame: 1,
        playerIds: ['a', 'b', 'c'],
        attempt: 0
    });
    assert.deepEqual(Object.keys(round.streams), ['a', 'b', 'c']);
    assert.notDeepEqual(round.streams.a, round.streams.b);
});

test('Crusher Escalator gives 4 seconds for the ending animation', () => {
    assert.equal(crusherEscalatorModule.finishAnimationMs, 4_000);
});

test('Crusher Escalator is played for 2 scoring rounds', () => {
    assert.equal(crusherEscalatorModule.roundsPerGame, 2);
});

const roundWith = (ids: string[]) => ({
    stage: 'final' as const,
    groups: [ids],
    streams: Object.fromEntries(ids.map((id) => [id, [...STREAM]]))
});

const result = (inputs: Input[]) => ({ inputs, timingSuspect: false });

test('rank puts the survivor first and orders the crushed by how long they lasted', () => {
    const ranked = crusherEscalatorModule.rank(
        [
            { playerId: 'early', result: result([]) },
            { playerId: 'winner', result: result(presses(40, 100)) },
            { playerId: 'late', result: result(presses(40, 100, (i) => i < 6)) }
        ],
        roundWith(['early', 'winner', 'late'])
    );
    assert.deepEqual(
        ranked.map((row) => [row.playerId, row.rank]),
        [['winner', 1], ['late', 2], ['early', 3]]
    );
    assert.equal(ranked[0]!.detail.survived, true);
    assert.equal(ranked[2]!.detail.survived, false);
});

test('rank ignores the order results arrived in (latency cannot change the winner)', () => {
    const entries = [
        { playerId: 'a', result: result(presses(40, 100)) },
        { playerId: 'b', result: result(presses(40, 130)) }
    ];
    const round = roundWith(['a', 'b']);
    assert.deepEqual(
        crusherEscalatorModule.rank(entries, round),
        crusherEscalatorModule.rank([...entries].reverse(), round)
    );
});

test('equal scores at the time cap share rank 1, which triggers a tiebreaker', () => {
    const ranked = crusherEscalatorModule.rank(
        [
            { playerId: 'a', result: result(presses(5, 100)) },
            { playerId: 'b', result: result(presses(5, 100)) }
        ],
        roundWith(['a', 'b'])
    );
    assert.deepEqual(ranked.map((row) => row.rank), [1, 1]);
});

test('parseResult accepts well-formed presses and rejects bad ones', () => {
    const ok = parseCrusherEscalatorResult({
        inputs: [{ direction: 'up', atMs: 10.4 }, { direction: 'left', atMs: 10.6 }],
        timingSuspect: true
    });
    assert.deepEqual(ok?.inputs, [
        { direction: 'up', atMs: 10 },
        { direction: 'left', atMs: 11 }
    ]);
    assert.equal(ok?.timingSuspect, true);

    const bad: unknown[] = [
        null,
        {},
        { inputs: 'x' },
        { inputs: [{ direction: 'forward', atMs: 1 }] },
        { inputs: [{ direction: 'up', atMs: -1 }] },
        { inputs: [{ direction: 'up', atMs: CRUSHER_ESCALATOR.MAX_RACE_MS + 1 }] },
        { inputs: [{ direction: 'up', atMs: 50 }, { direction: 'down', atMs: 40 }] },
        { inputs: Array(CRUSHER_ESCALATOR.MAX_INPUTS + 1).fill({ direction: 'up', atMs: 1 }) }
    ];
    for (const raw of bad) assert.equal(parseCrusherEscalatorResult(raw), null);
});

test('parseProgress accepts a whole-number score only', () => {
    assert.deepEqual(parseCrusherEscalatorProgress({ score: 7 }), { score: 7 });
    assert.equal(parseCrusherEscalatorProgress({ score: -1 }), null);
    assert.equal(parseCrusherEscalatorProgress({ score: 1.5 }), null);
    assert.equal(parseCrusherEscalatorProgress({}), null);
});

/* ---------------- heats and the final ---------------- */

const FINALISTS = CRUSHER_ESCALATOR.FINALISTS;
const HEATS: RaceRules = { survivorsToEnd: FINALISTS };

test('players are split into two groups as evenly as possible', () => {
    for (const count of [7, 8, 9, 11, 12]) {
        const ids = Array.from({ length: count }, (_, i) => `p${i}`);
        const [first, second] = splitIntoTwoGroups(ids, seededRandom(count));
        assert.equal(first.length, Math.ceil(count / 2));
        assert.equal(second.length, Math.floor(count / 2));
        assert.deepEqual([...first, ...second].sort(), [...ids].sort());
    }
});

const roundData = (playerCount: number, attempt = 0) =>
    crusherEscalatorModule.createRoundData({
        roundInGame: 1,
        roundsPerGame: 2,
        playerIds: Array.from({ length: playerCount }, (_, i) => `p${i}`),
        attempt
    });

test('up to 6 players race together in a single final, with no heats', () => {
    const round = roundData(6);
    assert.equal(round.stage, 'final');
    assert.equal(round.groups.length, 1);
    assert.equal(round.groups[0]!.length, 6);
});

test('more than 6 players start in two heats', () => {
    const round = roundData(8);
    assert.equal(round.stage, 'heats');
    assert.deepEqual(round.groups.map((g) => g.length), [4, 4]);
    assert.equal(Object.keys(round.streams).length, 8);
});

test('a later attempt is always a single-group final, even with 7+ players', () => {
    const round = roundData(7, 1);
    assert.equal(round.stage, 'final');
    assert.equal(round.groups.length, 1);
});

test('the gap rule only compares players inside the same group', () => {
    // a strongly leads heat 1, but b in heat 2 is level with its own group.
    const outcomes = raceOf(
        [
            racer('a', presses(20, 100), 'one'),
            racer('b', [], 'two'),
            racer('c', presses(20, 100), 'two')
        ],
        { survivorsToEnd: 1 }
    );
    // b is behind c (same heat) and crushed; a is not what crushes anyone in heat 2.
    assert.equal(outcomeOf(outcomes, 'b').eliminatedAtMs, GAP * 100);
});

test('a heat leader cannot crush a player in the other heat', () => {
    const outcomes = raceOf(
        [
            racer('a', presses(GAP, 100), 'one'),
            racer('a2', presses(GAP, 100), 'one'),
            racer('b', [], 'two'),
            racer('b2', [], 'two'),
            racer('c', [], 'two')
        ],
        { survivorsToEnd: 1 }
    );
    // Heat two is all on 0, so nobody there is more than GAP behind their leader.
    for (const id of ['b', 'b2', 'c']) {
        assert.equal(outcomeOf(outcomes, id).eliminatedAtMs, null, id);
    }
});

test('the heats run until 6 are left, then stop: later presses are ignored', () => {
    // Heat one: a3 never scores and is crushed at 800 ms (when a1 reaches 8).
    // Heat two: b4 scores only 3 and is crushed at 1100 ms (when b1 reaches 11).
    const outcomes = raceOf(
        [
            racer('a1', presses(40, 100), 'one'),
            racer('a2', presses(40, 100), 'one'),
            racer('a3', [], 'one'),
            racer('a4', presses(40, 100), 'one'),
            racer('b1', presses(40, 100), 'two'),
            racer('b2', presses(40, 100), 'two'),
            racer('b3', presses(40, 100), 'two'),
            racer('b4', presses(40, 100, (i) => i < 3), 'two')
        ],
        HEATS
    );

    assert.equal(outcomeOf(outcomes, 'a3').eliminatedAtMs, 8 * 100);
    assert.equal(outcomeOf(outcomes, 'b4').eliminatedAtMs, 11 * 100);
    assert.equal(outcomes.filter((o) => o.eliminatedAtMs === null).length, FINALISTS);
    // The heats stopped at 1100 ms, so nobody scored past it.
    assert.ok(outcomes.every((o) => o.score <= 11));
});

const roundOf = (stage: 'heats' | 'final', groups: string[][]) => ({
    stage,
    groups,
    streams: Object.fromEntries(groups.flat().map((id) => [id, [...STREAM]]))
});

test('exactly one crushed brings 7 players to 6 and the heats end there', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const round = roundOf('heats', [ids.slice(0, 4), ids.slice(4)]);
    const entries = ids.map((playerId) => ({
        playerId,
        // p1 races ahead; p4 (same heat) never scores and is the only one crushed.
        result: result(playerId === 'p1' ? presses(40, 100) : playerId === 'p4' ? [] : presses(2, 100))
    }));

    const ranked = crusherEscalatorModule.rank(entries, round);
    const advance = crusherEscalatorModule.nextStage!(ranked, round);

    assert.equal(advance?.participants.length, FINALISTS);
    assert.ok(!advance?.participants.includes('p4'));
    assert.equal(advance?.pauseMs, 3_000);
});

test('players tied with the last qualifier also go through', () => {
    const round = roundOf('heats', [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
    // Nobody ever scores, so no one is crushed: all 8 are level and all advance.
    const entries = round.groups.flat().map((playerId) => ({ playerId, result: result([]) }));
    const advance = crusherEscalatorModule.nextStage!(
        crusherEscalatorModule.rank(entries, round),
        round
    );
    assert.equal(advance?.participants.length, 8);
});

test('the final does not advance to another stage', () => {
    const round = roundOf('final', [['a', 'b', 'c']]);
    const entries = ['a', 'b', 'c'].map((playerId) => ({ playerId, result: result(presses(20, 100)) }));
    assert.equal(
        crusherEscalatorModule.nextStage!(crusherEscalatorModule.rank(entries, round), round),
        null
    );
});

test('a lone reporter in the heats just wins, with no final', () => {
    const round = roundOf('heats', [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
    const ranked = crusherEscalatorModule.rank([{ playerId: 'a', result: result([]) }], round);
    assert.equal(crusherEscalatorModule.nextStage!(ranked, round), null);
});

test('the final starts everyone from 0 with fresh streams', () => {
    const heats = roundData(8);
    const final = roundData(6, 1);
    assert.equal(final.stage, 'final');
    // Scores are not carried over: a final race begins with an empty replay.
    const outcomes = raceOf(Object.keys(final.streams).map((id) => racer(id, [])));
    assert.ok(outcomes.every((o) => o.score === CRUSHER_ESCALATOR.STARTING_SCORE));
    assert.equal(Object.keys(heats.streams).length, 8);
});

test('the final runs on a shorter run-up than a normal start', () => {
    const round = roundOf('heats', [['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
    const entries = round.groups.flat().map((playerId) => ({ playerId, result: result([]) }));
    const advance = crusherEscalatorModule.nextStage!(crusherEscalatorModule.rank(entries, round), round);
    assert.equal(advance?.timing?.countdownMs, CRUSHER_ESCALATOR.FINAL_COUNTDOWN_MS);
});
