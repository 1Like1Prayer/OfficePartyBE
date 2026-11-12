import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { SelfTimedRound } from './selfTimedRound';
import { hmacRollFace } from './diceRolls';
import { SELF_TIMED } from '../shared/constants';
import { createTypeRacerModule } from '../shared/games/typeRacer/module';
import { logDodgeModule } from '../shared/games/logDodge/module';
import type { ProgressPayload, RoundDataPayload } from '../shared/protocol';
import type { TypeRacerRound } from '../shared/games/typeRacer/types';

const setup = () => {
    const progress: ProgressPayload[] = [];
    const roundData: RoundDataPayload<TypeRacerRound>[] = [];
    const noop = () => {};
    const round = new SelfTimedRound({
        module: createTypeRacerModule(hmacRollFace),
        gameId: 'type-racer-roulette',
        roundId: 1,
        gameIndex: 1,
        totalGames: 1,
        roundInGame: 1,
        roundsPerGame: 2,
        events: {
            onRoundData: (p) => roundData.push(p as RoundDataPayload<TypeRacerRound>),
            onReadyState: noop,
            onStartAt: noop,
            onProgress: (p) => progress.push(p),
            onAttemptResolved: noop
        }
    });
    round.begin(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) round.markReady(id, 0);
    mock.timers.tick(SELF_TIMED.START_LEAD_MS);
    mock.timers.tick(SELF_TIMED.COUNTDOWN_MS);
    return { round, progress, roundData };
};

const update = (chars: number) => ({ chars, paragraph: 0, strikes: 0, skulls: 0, status: 0 });
const roll = { type: 'roll', rollIndex: 0 };

test('a player whose connection blips mid-race can rejoin: progress, dice and result all work again', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, progress } = setup();

        round.dropParticipant('a');
        // While dropped, nothing from them is accepted.
        round.submitProgress('a', 0, update(5));
        assert.equal(progress.length, 0);
        assert.equal(round.handleAction('a', 0, roll).ok, false);

        assert.equal(round.rejoinParticipant('a'), true);
        round.submitProgress('a', 0, update(7));
        assert.deepEqual(progress.map((p) => [p.playerId, p.progress.chars]), [['a', 7]]);
        assert.equal(round.handleAction('a', 0, roll).ok, true);
        assert.equal(round.submitResult('a', 0, { events: [], endedAtMs: 1_000 }).ok, true);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('only a player who dropped out of the running attempt can rejoin it', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round } = setup();
        assert.equal(round.rejoinParticipant('a'), false);
        assert.equal(round.rejoinParticipant('stranger'), false);

        round.dropParticipant('a');
        assert.equal(round.rejoinParticipant('a'), true);
        assert.equal(round.rejoinParticipant('a'), false);

        round.cancel();
        round.dropParticipant('b');
        assert.equal(round.rejoinParticipant('b'), false);
    } finally {
        mock.timers.reset();
    }
});

test('a progress update inside the rate limit is delivered afterwards, not lost', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, progress } = setup();

        round.submitProgress('a', 0, update(1));
        round.submitProgress('a', 0, update(2));
        round.submitProgress('a', 0, update(3));
        assert.deepEqual(progress.map((p) => p.progress.chars), [1]);

        mock.timers.tick(SELF_TIMED.PROGRESS_MIN_INTERVAL_MS + 20);
        // The newest of the held updates goes out; the ones it replaced do not.
        assert.deepEqual(progress.map((p) => p.progress.chars), [1, 3]);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('a held progress update is dropped if the player has left by then', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, progress } = setup();
        round.submitProgress('a', 0, update(1));
        round.submitProgress('a', 0, update(2));
        round.dropParticipant('a');
        mock.timers.tick(SELF_TIMED.PROGRESS_MIN_INTERVAL_MS + 20);
        assert.deepEqual(progress.map((p) => p.progress.chars), [1]);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('a result that shows a knock-out is announced to the room as full hits, even without progress messages', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const progress: ProgressPayload[] = [];
        const noop = () => {};
        const round = new SelfTimedRound({
            module: logDodgeModule,
            gameId: 'log-dodge',
            roundId: 1,
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1,
            roundsPerGame: 2,
            events: {
                onRoundData: noop,
                onReadyState: noop,
                onStartAt: noop,
                onProgress: (p) => progress.push(p),
                onAttemptResolved: noop
            }
        });
        round.begin(['a', 'b', 'c']);
        for (const id of ['a', 'b', 'c']) round.markReady(id, 0);
        mock.timers.tick(SELF_TIMED.START_LEAD_MS);
        mock.timers.tick(SELF_TIMED.COUNTDOWN_MS);

        // 'a' never pressed anything, so is knocked out. Nobody sent a progress message.
        round.submitResult('a', 0, { inputs: [], timingSuspect: false });
        assert.deepEqual(progress.map((p) => [p.playerId, p.progress.hits]), [['a', 3]]);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});
