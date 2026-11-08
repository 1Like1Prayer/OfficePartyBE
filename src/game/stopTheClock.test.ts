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

test('Stop the Clock is played for 4 rounds', () => {
    assert.equal(stopTheClockModule.roundsPerGame, 4);
});

test('isBlindRound: 4 rounds -> rounds 1-2 normal, rounds 3-4 faded', () => {
    assert.deepEqual(blindRounds(STOP_THE_CLOCK.ROUNDS_PER_GAME), [3, 4]);
});

test('blind rounds target 4-8s in whole seconds', () => {
    for (let i = 0; i < 2000; i++) {
        const round = createRoundData({ roundInGame: 4, roundsPerGame: 4 });
        assert.equal(round.blind, true);
        assert.ok(round.targetMs >= 4_000 && round.targetMs <= 8_000);
        assert.equal(round.targetMs % 1_000, 0);
    }
});

test('non-blind rounds target 2-8s in whole seconds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
        const round = createRoundData({ roundInGame: 1, roundsPerGame: 4 });
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
    const blind = startRound(4, 4);
    const normal = startRound(1, 4);
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
    const { round, payloads } = startRound(4, 4);
    try {
        const snap = round.snapshotRoundData();
        assert.deepEqual(snap?.data, payloads[0]!.data);
        assert.equal((snap?.data as StopTheClockRound).blind, true);
    } finally {
        round.cancel();
    }
});
