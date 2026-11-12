import test from 'node:test';
import assert from 'node:assert/strict';
import type { RandomSource } from '../random';
import { COUNTER_ACTION, LOG_DODGE } from './constants';
import { judgePlayer } from './judge';
import { logDodgeModule, createRoundData } from './module';
import { parseLogDodgeProgress, parseLogDodgeResult } from './parsing';
import { generateLogs } from './schedule';
import type { Input, Log } from './types';

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

const WINDOW = LOG_DODGE.HIT_WINDOW_MS;

const log = (arriveAtMs: number, height: Log['height'] = 'low'): Log => ({
    height,
    arriveAtMs,
    travelMs: 2_000,
    angleDeg: 0
});

/** Presses exactly on time for every log. */
const perfectInputs = (logs: readonly Log[]): Input[] =>
    logs.map((l) => ({ action: COUNTER_ACTION[l.height], atMs: l.arriveAtMs }));

/* ---------------- schedule ---------------- */

test('the schedule is sorted, starts after the grace period and ends inside the round', () => {
    for (let seed = 1; seed <= 50; seed++) {
        const logs = generateLogs(seededRandom(seed));
        assert.ok(logs.length > 0);
        assert.ok(logs[0]!.arriveAtMs >= LOG_DODGE.FIRST_ARRIVAL_MS);
        for (let i = 1; i < logs.length; i++) {
            assert.ok(logs[i]!.arriveAtMs > logs[i - 1]!.arriveAtMs, `seed ${seed}`);
        }
        const last = logs[logs.length - 1]!;
        assert.ok(last.arriveAtMs + WINDOW <= LOG_DODGE.DURATION_MS, `seed ${seed}`);
    }
});

test('a log never appears before the round starts', () => {
    for (let seed = 1; seed <= 50; seed++) {
        for (const l of generateLogs(seededRandom(seed))) {
            assert.ok(l.arriveAtMs - l.travelMs >= 0);
        }
    }
});

const gapsOf = (logs: readonly Log[]) =>
    logs.slice(1).map((l, i) => ({ at: l.arriveAtMs, gap: l.arriveAtMs - logs[i]!.arriveAtMs }));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('logs get closer together until the hard part, and never closer than 0.3s', () => {
    for (let seed = 1; seed <= 30; seed++) {
        const gaps = gapsOf(generateLogs(seededRandom(seed)));
        assert.ok(gaps.every(({ gap }) => gap >= 300), `seed ${seed}`);
        assert.equal(LOG_DODGE.MIN_GAP_MS, 300);
    }
    const gaps = gapsOf(generateLogs(seededRandom(7)));
    const early = gaps.filter(({ at }) => at < 10_000).map(({ gap }) => gap);
    const hard = gaps.filter(({ at }) => at >= LOG_DODGE.HARD_FROM_MS).map(({ gap }) => gap);
    assert.ok(mean(early) > 1.5 * mean(hard));
});

test('the round reaches full difficulty at 40s and then stays there', () => {
    const gaps = gapsOf(generateLogs(seededRandom(11)));
    const justAfter = gaps.filter(({ at }) => at >= 40_000 && at < 50_000).map(({ gap }) => gap);
    const late = gaps.filter(({ at }) => at >= 50_000).map(({ gap }) => gap);
    assert.ok(Math.abs(mean(justAfter) - mean(late)) < 150);
    assert.ok(mean(late) < LOG_DODGE.HARD_GAP_MS * 1.2);
});

test('logs move at different speeds: travel time is anywhere from 2s to 4s', () => {
    const [min, max] = LOG_DODGE.TRAVEL_RANGE_MS;
    assert.deepEqual([min, max], [2_000, 4_000]);
    assert.ok(LOG_DODGE.FIRST_ARRIVAL_MS >= max);

    const times = generateLogs(seededRandom(5)).map((l) => l.travelMs);
    assert.ok(times.every((t) => t >= min && t <= max));
    assert.ok(new Set(times).size > times.length / 2);
    assert.ok(Math.min(...times) < 2_500 && Math.max(...times) > 3_500);
});

test('every log can be dodged by pressing on time, so the cooldown must not exceed the minimum gap', () => {
    assert.ok(LOG_DODGE.INPUT_COOLDOWN_MS <= LOG_DODGE.MIN_GAP_MS);
    for (let seed = 1; seed <= 30; seed++) {
        const logs = generateLogs(seededRandom(seed));
        const outcome = judgePlayer(logs, perfectInputs(logs));
        assert.equal(outcome.hits, 0, `seed ${seed}`);
        assert.equal(outcome.dodged, logs.length);
    }
});

test('both heights and a spread of angles appear', () => {
    const logs = generateLogs(seededRandom(3));
    assert.equal(new Set(logs.map((l) => l.height)).size, 2);
    assert.ok(new Set(logs.map((l) => l.angleDeg)).size > 10);
});

/* ---------------- judging ---------------- */

test('pressing the right action inside the window dodges, at both edges', () => {
    const logs = [log(5_000), log(8_000), log(11_000)];
    const outcome = judgePlayer(logs, [
        { action: 'jump', atMs: 5_000 - WINDOW },
        { action: 'jump', atMs: 8_000 + WINDOW },
        { action: 'jump', atMs: 11_000 }
    ]);
    assert.equal(outcome.hits, 0);
    assert.equal(outcome.dodged, 3);
    assert.equal(outcome.totalErrorMs, WINDOW * 2);
});

test('a press one ms outside the window does not dodge', () => {
    const outcome = judgePlayer([log(5_000)], [{ action: 'jump', atMs: 5_000 + WINDOW + 1 }]);
    assert.equal(outcome.hits, 1);
    assert.equal(outcome.dodged, 0);
});

test('the wrong action does not dodge', () => {
    const logs = [log(5_000, 'low'), log(8_000, 'high')];
    const outcome = judgePlayer(logs, [
        { action: 'duck', atMs: 5_000 },
        { action: 'jump', atMs: 8_000 }
    ]);
    assert.equal(outcome.hits, 2);
    assert.equal(outcome.dodged, 0);
});

test('each height is countered by its own action', () => {
    const logs = [log(5_000, 'low'), log(8_000, 'high')];
    const outcome = judgePlayer(logs, [
        { action: 'jump', atMs: 5_000 },
        { action: 'duck', atMs: 8_000 }
    ]);
    assert.equal(outcome.hits, 0);
});

test('one press dodges at most one log, even when windows overlap', () => {
    const logs = [log(5_000), log(5_400)];
    const outcome = judgePlayer(logs, [{ action: 'jump', atMs: 5_200 }]);
    assert.equal(outcome.dodged, 1);
    assert.equal(outcome.hits, 1);
});

test('presses inside the cooldown are ignored, so pressing faster than the cooldown loses a log', () => {
    const logs = [log(5_000, 'low'), log(5_150, 'high'), log(5_300, 'low')];
    const mash: Input[] = [
        { action: 'jump', atMs: 5_000 },
        { action: 'duck', atMs: 5_150 },
        { action: 'jump', atMs: 5_300 }
    ];
    const outcome = judgePlayer(logs, mash);
    // The duck at 5150 falls inside the cooldown of the jump at 5000.
    assert.equal(outcome.dodged, 2);
    assert.equal(outcome.hits, 1);
});

test('a wasted press still uses up the cooldown', () => {
    const outcome = judgePlayer([log(5_000)], [
        { action: 'duck', atMs: 4_700 },
        { action: 'jump', atMs: 4_700 + LOG_DODGE.INPUT_COOLDOWN_MS - 1 }
    ]);
    assert.equal(outcome.dodged, 0);
});

test('the third hit eliminates the player when that log passes; later logs do not count', () => {
    const logs = [log(5_000), log(8_000), log(11_000), log(14_000), log(17_000)];
    const outcome = judgePlayer(logs, []);
    assert.equal(outcome.hits, LOG_DODGE.MAX_HITS);
    assert.equal(outcome.eliminatedAtMs, 11_000 + WINDOW);
});

test('two hits is survivable', () => {
    const logs = [log(5_000), log(8_000), log(11_000)];
    const outcome = judgePlayer(logs, perfectInputs(logs).slice(2));
    assert.equal(outcome.hits, 2);
    assert.equal(outcome.eliminatedAtMs, null);
});

/* ---------------- ranking ---------------- */

const resultFor = (inputs: Input[]) => ({ inputs, timingSuspect: false });

test('survivors beat the knocked-out; later knockouts beat earlier ones', () => {
    const round = { durationMs: 60_000, logs: [log(5_000), log(8_000), log(11_000), log(14_000)] };
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'dead-early', result: resultFor([]) },
            { playerId: 'alive', result: resultFor(perfectInputs(round.logs)) },
            {
                playerId: 'dead-late',
                result: resultFor([{ action: 'jump', atMs: 5_000 }])
            }
        ],
        round
    );
    assert.deepEqual(
        ranked.map((r) => r.playerId),
        ['alive', 'dead-late', 'dead-early']
    );
    assert.deepEqual(ranked.map((r) => r.rank), [1, 2, 3]);
});

test('survivors are ordered by fewest hits, then by timing accuracy', () => {
    const logs = [log(5_000), log(8_000), log(11_000)];
    const sloppy = [
        { action: 'jump' as const, atMs: 5_300 },
        { action: 'jump' as const, atMs: 8_300 },
        { action: 'jump' as const, atMs: 11_300 }
    ];
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'sloppy', result: resultFor(sloppy) },
            { playerId: 'one-hit', result: resultFor(perfectInputs(logs).slice(0, 2)) },
            { playerId: 'sharp', result: resultFor(perfectInputs(logs)) }
        ],
        { durationMs: 60_000, logs }
    );
    assert.deepEqual(
        ranked.map((r) => r.playerId),
        ['sharp', 'sloppy', 'one-hit']
    );
});

test('identical survivors share rank 1, which sends them to the runner tiebreaker', () => {
    const logs = [log(5_000), log(8_000)];
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'a', result: resultFor(perfectInputs(logs)) },
            { playerId: 'b', result: resultFor(perfectInputs(logs)) },
            { playerId: 'c', result: resultFor([]) }
        ],
        { durationMs: 60_000, logs }
    );
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1, 3]);
});

test('the result detail reports hits, dodges and survival', () => {
    const logs = [log(5_000), log(8_000)];
    const [only] = logDodgeModule.rank(
        [{ playerId: 'a', result: resultFor(perfectInputs(logs).slice(0, 1)) }],
        { durationMs: 60_000, logs }
    );
    assert.deepEqual(only!.detail, {
        hits: 1,
        dodged: 1,
        survived: true,
        averageErrorMs: 0,
        timingSuspect: false
    });
});

/* ---------------- module ---------------- */

test('round data is one shared schedule and a tiebreaker gets a fresh one', () => {
    const context = { roundInGame: 1, roundsPerGame: 1, playerIds: ['a', 'b'], attempt: 0 };
    const first = createRoundData(context, seededRandom(1));
    const second = createRoundData({ ...context, attempt: 1 }, seededRandom(2));
    assert.equal(first.durationMs, LOG_DODGE.DURATION_MS);
    assert.notDeepEqual(first.logs, second.logs);
});

test('the server waits for the round plus a grace period', () => {
    const round = createRoundData(
        { roundInGame: 1, roundsPerGame: 1, playerIds: ['a'], attempt: 0 },
        seededRandom(1)
    );
    assert.equal(
        logDodgeModule.resultTimeoutMs(round),
        LOG_DODGE.DURATION_MS + LOG_DODGE.RESULT_GRACE_MS
    );
});

/* ---------------- parsing ---------------- */

test('a well-formed result parses', () => {
    const parsed = parseLogDodgeResult({
        inputs: [
            { action: 'jump', atMs: 5000.4 },
            { action: 'duck', atMs: 9000 }
        ],
        timingSuspect: true
    });
    assert.deepEqual(parsed, {
        inputs: [
            { action: 'jump', atMs: 5000 },
            { action: 'duck', atMs: 9000 }
        ],
        timingSuspect: true
    });
});

test('malformed results are rejected', () => {
    const bad: unknown[] = [
        null,
        'x',
        {},
        { inputs: 'no' },
        { inputs: [{ action: 'fly', atMs: 1 }] },
        { inputs: [{ action: 'jump', atMs: -1 }] },
        { inputs: [{ action: 'jump', atMs: LOG_DODGE.DURATION_MS + 1 }] },
        { inputs: [{ action: 'jump', atMs: NaN }] },
        {
            inputs: [
                { action: 'jump', atMs: 2000 },
                { action: 'jump', atMs: 1000 }
            ]
        },
        { inputs: Array.from({ length: LOG_DODGE.MAX_INPUTS + 1 }, () => ({ action: 'jump', atMs: 1 })) }
    ];
    for (const raw of bad) assert.equal(parseLogDodgeResult(raw), null, JSON.stringify(raw)?.slice(0, 60));
});

test('progress accepts a hit count in range and nothing else', () => {
    assert.deepEqual(parseLogDodgeProgress({ hits: 2 }), { hits: 2 });
    assert.equal(parseLogDodgeProgress({ hits: 4 }), null);
    assert.equal(parseLogDodgeProgress({ hits: 1.5 }), null);
    assert.equal(parseLogDodgeProgress({ hits: -1 }), null);
    assert.equal(parseLogDodgeProgress(null), null);
});

/* ---------------- one survivor ends the round ---------------- */

const FIVE_LOGS = [log(5_000), log(8_000), log(11_000), log(14_000), log(17_000)];
const FIVE_ROUND = { durationMs: 60_000, logs: FIVE_LOGS };

test('judging can be cut off: logs settled after the cut-off do not count', () => {
    const outcome = judgePlayer(FIVE_LOGS, [], 11_000 + WINDOW);
    assert.equal(outcome.hits, 3);
    assert.equal(outcome.eliminatedAtMs, 11_000 + WINDOW);

    const early = judgePlayer(FIVE_LOGS, [], 8_000 + WINDOW);
    assert.equal(early.hits, 2);
    assert.equal(early.eliminatedAtMs, null);
});

test('the last player standing wins and the logs stop, so their later misses do not count', () => {
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'loser', result: resultFor([]) },
            // Dodges the first three, then stops pressing: on a full replay they
            // would be knocked out too, later than the loser.
            { playerId: 'winner', result: resultFor(perfectInputs(FIVE_LOGS).slice(0, 3)) }
        ],
        FIVE_ROUND
    );
    assert.deepEqual(ranked.map((r) => [r.playerId, r.rank]), [['winner', 1], ['loser', 2]]);

    const winner = ranked[0]!;
    assert.equal(winner.detail.survived, true);
    assert.equal(winner.detail.hits, 0);
    assert.equal(winner.detail.roundEndedAtMs, 11_000 + WINDOW);
    assert.equal(ranked[1]!.detail.roundEndedAtMs, 11_000 + WINDOW);
});

test('with several players, the round ends when the second-to-last is knocked out', () => {
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'first-out', result: resultFor([]) },
            { playerId: 'second-out', result: resultFor(perfectInputs(FIVE_LOGS).slice(0, 1)) },
            { playerId: 'winner', result: resultFor(perfectInputs(FIVE_LOGS).slice(0, 4)) }
        ],
        FIVE_ROUND
    );
    assert.deepEqual(ranked.map((r) => r.playerId), ['winner', 'second-out', 'first-out']);
    // second-out dodged log 1 and missed logs 2, 3, 4: third miss closes at 14000 + window.
    assert.equal(ranked[0]!.detail.roundEndedAtMs, 14_000 + WINDOW);
});

test('if the last two are knocked out together nobody is left and they tie for the tiebreaker', () => {
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'a', result: resultFor([]) },
            { playerId: 'b', result: resultFor([]) }
        ],
        FIVE_ROUND
    );
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1]);
});

test('with two or more still standing at the end, the round runs its full length', () => {
    const logs = [log(5_000), log(8_000)];
    const ranked = logDodgeModule.rank(
        [
            { playerId: 'a', result: resultFor(perfectInputs(logs)) },
            { playerId: 'b', result: resultFor(perfectInputs(logs).slice(0, 1)) },
            { playerId: 'c', result: resultFor([]) }
        ],
        { durationMs: 60_000, logs }
    );
    assert.deepEqual(ranked.map((r) => r.playerId), ['a', 'b', 'c']);
    assert.ok(ranked.every((r) => r.detail.roundEndedAtMs === undefined));
});

test('a lone player never ends the round early', () => {
    const [only] = logDodgeModule.rank([{ playerId: 'a', result: resultFor([]) }], FIVE_ROUND);
    assert.equal(only!.detail.roundEndedAtMs, undefined);
});

test('the win animation lasts five seconds', () => {
    assert.equal(logDodgeModule.finishAnimationMs, 5_000);
});
