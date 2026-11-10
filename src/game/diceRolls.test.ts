import test from 'node:test';
import assert from 'node:assert/strict';
import { SelfTimedRound } from './selfTimedRound';
import { hmacRollFace } from './diceRolls';
import { SELF_TIMED } from '../shared/constants';
import { createTypeRacerModule } from '../shared/games/typeRacer/module';
import { TYPE_RACER } from '../shared/games/typeRacer/constants';
import { mock } from 'node:test';

test('a roll is always a valid face and the same inputs give the same roll', () => {
    for (let i = 0; i < 200; i++) {
        const face = hmacRollFace('nonce', 'p1', i);
        assert.ok(Number.isInteger(face) && face >= 1 && face <= TYPE_RACER.DICE_SIDES);
        assert.equal(face, hmacRollFace('nonce', 'p1', i));
    }
});

test('rolls differ by nonce, player and roll number, and cover every face', () => {
    const faces = new Set<number>();
    for (let i = 0; i < 300; i++) faces.add(hmacRollFace(`n${i}`, 'p1', 0));
    assert.equal(faces.size, TYPE_RACER.DICE_SIDES);

    const sequence = (player: string) =>
        Array.from({ length: 30 }, (_, i) => hmacRollFace('same', player, i)).join();
    assert.notEqual(sequence('alice'), sequence('bob'));
});

test('rolls are roughly fair', () => {
    const counts = new Array(TYPE_RACER.DICE_SIDES).fill(0);
    const total = 6_000;
    for (let i = 0; i < total; i++) counts[hmacRollFace(`n${i}`, 'p', 0) - 1]++;
    for (const count of counts) assert.ok(Math.abs(count - total / 6) < total * 0.04, counts.join());
});

test('the runner answers a roll request mid-race, and only while the race is running', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const module = createTypeRacerModule(hmacRollFace);
        const noop = () => {};
        const round = new SelfTimedRound({
            module,
            gameId: 'type-racer-roulette',
            roundId: 1,
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1,
            roundsPerGame: 2,
            events: {
                onRoundData: noop,
                onReadyState: noop,
                onStartAt: noop,
                onProgress: noop,
                onAttemptResolved: noop
            }
        });
        round.begin(['a', 'b']);

        // Not racing yet.
        assert.equal(round.handleAction('a', 0, { type: 'roll', rollIndex: 0 }).ok, false);

        round.markReady('a', 0);
        round.markReady('b', 0);
        mock.timers.tick(SELF_TIMED.START_LEAD_MS);
        mock.timers.tick(SELF_TIMED.COUNTDOWN_MS);

        const reply = round.handleAction('a', 0, { type: 'roll', rollIndex: 0 });
        assert.equal(reply.ok, true);
        if (reply.ok) {
            const roll = reply.data as { face: number; skulls: number; isSkull: boolean };
            assert.equal(roll.skulls, 1);
            assert.equal(roll.isSkull, roll.face === 1);
        }
        // Wrong attempt, unknown player and malformed requests are refused.
        assert.equal(round.handleAction('a', 5, { type: 'roll', rollIndex: 0 }).ok, false);
        assert.equal(round.handleAction('zed', 0, { type: 'roll', rollIndex: 0 }).ok, false);
        assert.equal(round.handleAction('a', 0, { type: 'nope' }).ok, false);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('the runner remembers each player\'s latest progress for a reconnecting client', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const module = createTypeRacerModule(hmacRollFace);
        const noop = () => {};
        const round = new SelfTimedRound({
            module,
            gameId: 'type-racer-roulette',
            roundId: 1,
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1,
            roundsPerGame: 2,
            events: {
                onRoundData: noop,
                onReadyState: noop,
                onStartAt: noop,
                onProgress: noop,
                onAttemptResolved: noop
            }
        });
        round.begin(['a', 'b']);
        round.markReady('a', 0);
        round.markReady('b', 0);
        mock.timers.tick(SELF_TIMED.START_LEAD_MS);
        mock.timers.tick(SELF_TIMED.COUNTDOWN_MS);

        const progress = { chars: 7, paragraph: 0, strikes: 1, skulls: 1, status: 0 };
        round.submitProgress('a', 0, progress);
        round.submitProgress('b', 0, { chars: 999999, paragraph: 0, strikes: 0, skulls: 1, status: 0 }); // out of range: dropped

        const snapshot = round.snapshotRoundData();
        assert.deepEqual(snapshot?.progress, { a: progress });

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('everyone races through the same paragraphs: one round, broadcast once, same on reconnect', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const noop = () => {};
        const broadcasts: unknown[] = [];
        const round = new SelfTimedRound({
            module: createTypeRacerModule(hmacRollFace),
            gameId: 'type-racer-roulette',
            roundId: 1,
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1,
            roundsPerGame: 2,
            events: {
                onRoundData: (payload) => broadcasts.push(payload.data),
                onReadyState: noop,
                onStartAt: noop,
                onProgress: noop,
                onAttemptResolved: noop
            }
        });
        round.begin(['a', 'b', 'c', 'd']);

        // One broadcast to the whole room, not one per player.
        assert.equal(broadcasts.length, 1);
        // Reconnecting players get exactly the same text.
        assert.deepEqual(round.snapshotRoundData()?.data, broadcasts[0]);
        // The paragraphs are not keyed by player at all.
        assert.deepEqual(Object.keys(broadcasts[0] as object).sort(), ['paragraphs', 'rollNonce']);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});
