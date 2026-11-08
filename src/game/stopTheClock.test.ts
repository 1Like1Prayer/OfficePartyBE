import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfTimedRound, type SelfTimedRoundEvents } from './selfTimedRound';
import type { RoundDataPayload } from '../shared/protocol';
import {
    STOP_THE_CLOCK,
    stopTheClockModule,
    type StopTheClockRound,
    createRoundData,
    isBlindRound,
    pickTargetMs,
    resultTimeoutMs
} from '../shared/games/stopTheClock';

const blindRounds = (roundsPerGame: number): number[] =>
    Array.from({ length: roundsPerGame }, (_, i) => i + 1).filter((roundInGame) =>
        isBlindRound({ roundInGame, roundsPerGame })
    );

test('isBlindRound: 2 rounds -> round 2', () => {
    assert.deepEqual(blindRounds(2), [2]);
});

test('isBlindRound: 3 rounds -> round 3', () => {
    assert.deepEqual(blindRounds(3), [3]);
});

test('isBlindRound: 5 rounds -> rounds 4 and 5', () => {
    assert.deepEqual(blindRounds(5), [4, 5]);
});

test('blind rounds target 4-8s in whole seconds', () => {
    for (let i = 0; i < 2000; i++) {
        const round = createRoundData({ roundInGame: 5, roundsPerGame: 5 });
        assert.equal(round.blind, true);
        assert.ok(round.targetMs >= 4_000 && round.targetMs <= 8_000);
        assert.equal(round.targetMs % 1_000, 0);
    }
});

test('non-blind rounds target 2-8s in whole seconds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
        const round = createRoundData({ roundInGame: 1, roundsPerGame: 5 });
        assert.equal(round.blind, false);
        assert.ok(round.targetMs >= 2_000 && round.targetMs <= 8_000);
        assert.equal(round.targetMs % 1_000, 0);
        seen.add(round.targetMs);
    }
    assert.ok(seen.has(2_000) && seen.has(8_000));
});

test('pickTargetMs honours a custom minimum', () => {
    for (let i = 0; i < 500; i++) {
        const ms = pickTargetMs(4_000);
        assert.ok(ms >= 4_000 && ms <= 8_000 && ms % 1_000 === 0);
    }
});

test('result timeout is target + grace and ignores blind', () => {
    for (const blind of [true, false]) {
        assert.equal(
            resultTimeoutMs({ targetMs: 8_000, blind }),
            8_000 + STOP_THE_CLOCK.RESULT_GRACE_MS
        );
    }
});

const startRound = (roundInGame: number, roundsPerGame: number) => {
    const payloads: RoundDataPayload[] = [];
    const noop = () => {};
    const events = {
        onRoundData: (p: RoundDataPayload) => payloads.push(p),
        onReadyState: noop,
        onStartAt: noop,
        onProgress: noop,
        onAttemptResolved: noop
    } as SelfTimedRoundEvents;
    const round = new SelfTimedRound({
        module: stopTheClockModule,
        gameId: stopTheClockModule.id as never,
        roundId: 1,
        gameIndex: 0,
        totalGames: 1,
        roundInGame,
        roundsPerGame,
        events
    });
    round.begin(['a', 'b']);
    return { round, payloads };
};

test('round:data carries blind and targetMs', () => {
    const blind = startRound(5, 5);
    const normal = startRound(1, 5);
    try {
        const b = blind.payloads[0]!.data as StopTheClockRound;
        const n = normal.payloads[0]!.data as StopTheClockRound;
        assert.equal(b.blind, true);
        assert.equal(n.blind, false);
        assert.equal(typeof b.targetMs, 'number');
        assert.equal(blind.payloads[0]!.resultTimeoutMs, resultTimeoutMs(b));
    } finally {
        blind.round.cancel();
        normal.round.cancel();
    }
});

test('reconnect snapshot keeps blind and the same target', () => {
    const { round, payloads } = startRound(5, 5);
    try {
        const snap = round.snapshotRoundData();
        assert.deepEqual(snap?.data, payloads[0]!.data);
        assert.equal((snap?.data as StopTheClockRound).blind, true);
    } finally {
        round.cancel();
    }
});
