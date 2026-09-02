import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    errorMs,
    parseResult,
    pickTargetMs,
    rank,
    resultTimeoutMs,
    STOP_THE_CLOCK
} from './stopTheClock';

const round = { targetMs: 4000 };

describe('stop the clock rules', () => {
    it('picks targets inside the band, on the 10 ms grid', () => {
        for (const r of [0, 0.001, 0.37, 0.5, 0.999, 1 - Number.EPSILON]) {
            const target = pickTargetMs(() => r);
            assert.ok(target >= STOP_THE_CLOCK.MIN_TARGET_MS);
            assert.ok(target <= STOP_THE_CLOCK.MAX_TARGET_MS);
            assert.equal(target % STOP_THE_CLOCK.TARGET_STEP_MS, 0);
        }
    });

    it('rounds reported times to integer milliseconds', () => {
        assert.deepEqual(parseResult({ elapsedMs: 4123.6 }), {
            elapsedMs: 4124,
            timingSuspect: false
        });
    });

    it('keeps the backgrounded-tab flag rather than silently scoring it', () => {
        assert.equal(
            parseResult({ elapsedMs: 100, timingSuspect: true })?.timingSuspect,
            true
        );
    });

    it('rejects malformed and impossible results', () => {
        for (const bad of [
            null,
            'nope',
            {},
            { elapsedMs: 'x' },
            { elapsedMs: NaN },
            { elapsedMs: -1 },
            { elapsedMs: STOP_THE_CLOCK.MAX_ELAPSED_MS + 1 }
        ]) {
            assert.equal(parseResult(bad), null, `should reject ${JSON.stringify(bad)}`);
        }
    });

    it('scores by absolute distance from the target', () => {
        assert.equal(errorMs({ elapsedMs: 4200, timingSuspect: false }, round), 200);
        assert.equal(errorMs({ elapsedMs: 3800, timingSuspect: false }, round), 200);
    });

    it('ranks closest first', () => {
        const ranked = rank(
            [
                { playerId: 'a', result: { elapsedMs: 4500, timingSuspect: false } },
                { playerId: 'b', result: { elapsedMs: 3990, timingSuspect: false } },
                { playerId: 'c', result: { elapsedMs: 4050, timingSuspect: false } }
            ],
            round
        );
        assert.deepEqual(
            ranked.map((r) => [r.playerId, r.rank]),
            [
                ['b', 1],
                ['c', 2],
                ['a', 3]
            ]
        );
    });

    it('shares rank 1 on an exact tie, including over and under', () => {
        const ranked = rank(
            [
                { playerId: 'a', result: { elapsedMs: 4100, timingSuspect: false } },
                { playerId: 'b', result: { elapsedMs: 3900, timingSuspect: false } },
                { playerId: 'c', result: { elapsedMs: 4300, timingSuspect: false } }
            ],
            round
        );
        const leaders = ranked.filter((r) => r.rank === 1).map((r) => r.playerId);
        assert.deepEqual(leaders.sort(), ['a', 'b']);
        assert.equal(ranked.find((r) => r.playerId === 'c')?.rank, 3);
    });

    it('gives an empty field an empty ranking', () => {
        assert.deepEqual(rank([], round), []);
    });

    it('allows at least the target plus grace before resolving', () => {
        assert.ok(resultTimeoutMs(round) > round.targetMs);
    });
});
