import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { SelfTimedRound, type AttemptResolved } from './selfTimedRound';
import { SELF_TIMED } from '../shared/constants';
import { logDodgeModule } from '../shared/games/logDodge/module';
import { crusherEscalatorModule } from '../shared/games/crusherEscalator/module';
import type { RoundClosingPayload, StartAtPayload } from '../shared/protocol';
import type { SelfTimedGameModule } from '../shared/games/selfTimed';
import type { GameId } from '../shared/games/catalog';
import { stopTheClockModule } from '../shared/games/stopTheClock';

const start = <TRound, TResult>(
    module: SelfTimedGameModule<TRound, TResult>,
    gameId: GameId,
    players: string[]
) => {
    const closing: RoundClosingPayload[] = [];
    const resolved: AttemptResolved[] = [];
    const starts: StartAtPayload[] = [];
    const noop = () => {};
    const round = new SelfTimedRound({
        module,
        gameId,
        roundId: 1,
        gameIndex: 1,
        totalGames: 1,
        roundInGame: 1,
        roundsPerGame: 2,
        events: {
            onRoundData: noop,
            onReadyState: noop,
            onStartAt: (p) => starts.push(p),
            onProgress: noop,
            onRoundClosing: (p) => closing.push(p),
            onAttemptResolved: (p) => resolved.push(p)
        }
    });
    round.begin(players);
    for (const id of players) round.markReady(id, 0);
    mock.timers.tick(SELF_TIMED.START_LEAD_MS);
    mock.timers.tick(starts[0]!.countdownMs);
    return { round, closing, resolved };
};

const result = { inputs: [], timingSuspect: false };

test('Log Dodge: when all but one have reported, the last is told to stop and report', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, closing, resolved } = start(logDodgeModule, 'log-dodge', ['a', 'b', 'c']);

        round.submitResult('a', 0, result);
        assert.equal(closing.length, 0);

        round.submitResult('b', 0, result);
        assert.equal(closing.length, 1);
        assert.deepEqual(closing[0]!.pending, ['c']);
        assert.equal(closing[0]!.graceMs, SELF_TIMED.CLOSING_GRACE_MS);
        assert.equal(resolved.length, 0);

        // The last player reports, and the round is decided from all three results.
        round.submitResult('c', 0, result);
        assert.equal(resolved.length, 1);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('the closing message is sent once, and a player who never reports is scored without after the grace', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, closing, resolved } = start(logDodgeModule, 'log-dodge', ['a', 'b', 'c']);
        round.submitResult('a', 0, result);
        round.submitResult('b', 0, result);
        round.dropParticipant('zzz');
        assert.equal(closing.length, 1);

        mock.timers.tick(SELF_TIMED.CLOSING_GRACE_MS - 1);
        assert.equal(resolved.length, 0);
        mock.timers.tick(1);
        assert.equal(resolved.length, 1);
        assert.deepEqual(resolved[0]!.noShow, ['c']);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('a player leaving counts too: two players, one reports, the other drops, nothing is left to wait for', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, closing, resolved } = start(logDodgeModule, 'log-dodge', ['a', 'b', 'c']);
        round.submitResult('a', 0, result);
        round.dropParticipant('b');
        // b is gone: a has reported, c is the only one left.
        assert.equal(closing.length, 1);
        assert.deepEqual(closing[0]!.pending, ['c']);
        assert.equal(resolved.length, 0);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('Crusher Escalator heats: the survivors are told to stop as soon as the heats are decided', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const players = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
        const { round, closing } = start(crusherEscalatorModule, 'crusher-escalator', players);

        // 8 players, heats end with 6 left: one report is not enough, two is.
        round.submitResult('p1', 0, { inputs: [], timingSuspect: false });
        assert.equal(closing.length, 0);
        round.submitResult('p2', 0, { inputs: [], timingSuspect: false });
        assert.equal(closing.length, 1);
        assert.deepEqual(closing[0]!.pending, ['p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('Crusher Escalator final: the last one racing is told to stop once everyone else is out', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, closing } = start(crusherEscalatorModule, 'crusher-escalator', ['a', 'b', 'c']);
        round.submitResult('a', 0, { inputs: [], timingSuspect: false });
        assert.equal(closing.length, 0);
        round.submitResult('b', 0, { inputs: [], timingSuspect: false });
        assert.deepEqual(closing[0]!.pending, ['c']);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});

test('games that do not end early never send a closing message', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { round, closing } = start(stopTheClockModule, 'stop-the-clock', ['a', 'b', 'c']);
        round.submitResult('a', 0, { stoppedAtMs: 1_000, timingSuspect: false });
        round.submitResult('b', 0, { stoppedAtMs: 1_000, timingSuspect: false });
        assert.equal(closing.length, 0);
        round.cancel();
    } finally {
        mock.timers.reset();
    }
});
