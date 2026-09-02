import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { SELF_TIMED } from '../shared/constants';
import { stopTheClockModule } from '../shared/games/stopTheClock';
import type {
    ProgressPayload,
    ReadyStatePayload,
    RoundDataPayload,
    StartAtPayload
} from '../shared/protocol';
import { FakeClock } from './clock';
import { SelfTimedRound, type AttemptResolved } from './selfTimedRound';

/** Every target is 2000 ms with this RNG, which keeps the arithmetic obvious. */
const fixedRng = () => 0;

const setup = (rng: () => number = fixedRng) => {
    const clock = new FakeClock();
    const roundData: RoundDataPayload[] = [];
    const readyStates: ReadyStatePayload[] = [];
    const starts: StartAtPayload[] = [];
    const progress: ProgressPayload[] = [];
    const resolved: AttemptResolved[] = [];

    const round = new SelfTimedRound({
        module: stopTheClockModule,
        gameId: 'stop-the-clock',
        roundId: 7,
        gameIndex: 1,
        totalGames: 1,
        roundInGame: 1,
        clock,
        rng,
        events: {
            onRoundData: (p) => roundData.push(p),
            onReadyState: (p) => readyStates.push(p),
            onStartAt: (p) => starts.push(p),
            onProgress: (p) => progress.push(p),
            onAttemptResolved: (p) => resolved.push(p)
        }
    });

    return { clock, round, roundData, readyStates, starts, progress, resolved };
};

/** Ready everyone up and run the clock to the scheduled start. */
const startPlaying = (
    ctx: ReturnType<typeof setup>,
    players: string[],
    attempt = 0
) => {
    for (const playerId of players) ctx.round.markReady(playerId, attempt);
    ctx.clock.advance(SELF_TIMED.START_LEAD_MS);
};

describe('self-timed round runner', () => {
    let ctx: ReturnType<typeof setup>;

    beforeEach(() => {
        ctx = setup();
    });

    it('does not schedule a start until everyone has acknowledged', () => {
        ctx.round.begin(['a', 'b']);
        assert.equal(ctx.roundData.length, 1);

        ctx.round.markReady('a', 0);
        assert.equal(ctx.starts.length, 0, 'start scheduled before everyone was ready');

        const waiting = ctx.readyStates.at(-1)!;
        assert.deepEqual(waiting.ready, ['a']);
        assert.deepEqual(waiting.waitingFor, ['b']);

        ctx.round.markReady('b', 0);
        assert.equal(ctx.starts.length, 1);
        assert.equal(
            ctx.starts[0]!.startAtServerMs,
            ctx.starts[0]!.serverTimeMs + SELF_TIMED.START_LEAD_MS
        );
    });

    it('resolves in favour of the closest reported time', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);

        ctx.round.submitResult('a', 0, { elapsedMs: 2400 });
        ctx.round.submitResult('b', 0, { elapsedMs: 2050 });

        const result = ctx.resolved.at(-1)!;
        assert.equal(result.isFinal, true);
        assert.equal(result.winnerId, 'b');
        assert.deepEqual(result.noShow, []);
    });

    it('is unaffected by latency: a slow reporter with a better time still wins', () => {
        // Both clients time the same interval with their own instrument. The
        // server only compares the numbers, so wall-clock arrival order is
        // irrelevant. This is the section 14 latency test.
        const fast = setup();
        fast.round.begin(['a', 'b']);
        startPlaying(fast, ['a', 'b']);
        fast.round.submitResult('a', 0, { elapsedMs: 2400 });
        fast.round.submitResult('b', 0, { elapsedMs: 2050 });

        const laggy = setup();
        laggy.round.begin(['a', 'b']);
        startPlaying(laggy, ['a', 'b']);
        laggy.clock.advance(300);
        laggy.round.submitResult('a', 0, { elapsedMs: 2400 });
        laggy.clock.advance(300);
        laggy.round.submitResult('b', 0, { elapsedMs: 2050 });

        assert.equal(laggy.resolved.at(-1)!.winnerId, fast.resolved.at(-1)!.winnerId);
        assert.deepEqual(laggy.resolved.at(-1)!.ranked, fast.resolved.at(-1)!.ranked);
    });

    it('resolves without a player who never reports', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);
        ctx.round.submitResult('a', 0, { elapsedMs: 2400 });
        assert.equal(ctx.resolved.length, 0, 'resolved before the timeout expired');

        ctx.clock.advance(stopTheClockModule.resultTimeoutMs({ targetMs: 2000 }) + 1);
        const result = ctx.resolved.at(-1)!;
        assert.equal(result.winnerId, 'a');
        assert.deepEqual(result.noShow, ['b']);
    });

    it('resolves with no winner when nobody reports', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);
        ctx.clock.advance(stopTheClockModule.resultTimeoutMs({ targetMs: 2000 }) + 1);

        const result = ctx.resolved.at(-1)!;
        assert.equal(result.isFinal, true);
        assert.equal(result.winnerId, null);
        assert.deepEqual(result.noShow.sort(), ['a', 'b']);
    });

    it('keeps the first report per player and ignores repeats', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);

        assert.equal(ctx.round.submitResult('a', 0, { elapsedMs: 2400 }).ok, true);
        const repeat = ctx.round.submitResult('a', 0, { elapsedMs: 2000 });
        assert.equal(repeat.ok, false);
        assert.equal(repeat.ok === false && repeat.code, 'duplicate_result');

        ctx.round.submitResult('b', 0, { elapsedMs: 2300 });
        assert.equal(ctx.resolved.at(-1)!.winnerId, 'b', 'the repeat was scored');
    });

    it('throws away a result tagged with a past attempt', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);
        const stale = ctx.round.submitResult('a', 99, { elapsedMs: 2000 });
        assert.equal(stale.ok, false);
        assert.equal(stale.ok === false && stale.code, 'stale_round');
    });

    it('rejects a malformed result without throwing', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);
        const bad = ctx.round.submitResult('a', 0, { elapsedMs: 'soon' });
        assert.equal(bad.ok, false);
        assert.equal(bad.ok === false && bad.code, 'invalid_payload');
    });

    it('sends an exact tie to a tiebreaker among just those players', () => {
        ctx.round.begin(['a', 'b', 'c']);
        startPlaying(ctx, ['a', 'b', 'c']);
        ctx.round.submitResult('a', 0, { elapsedMs: 2100 });
        ctx.round.submitResult('b', 0, { elapsedMs: 1900 });
        ctx.round.submitResult('c', 0, { elapsedMs: 2500 });

        const tie = ctx.resolved.at(-1)!;
        assert.equal(tie.isFinal, false, 'a tie should not award a point');
        assert.equal(tie.winnerId, null);

        ctx.clock.advance(5_000);
        const tiebreak = ctx.roundData.at(-1)!;
        assert.equal(tiebreak.attempt, 1);
        assert.equal(tiebreak.isTiebreak, true);
        assert.deepEqual(tiebreak.participants.sort(), ['a', 'b']);
        assert.equal(tiebreak.roundId, 7, 'roundId belongs to the scoring round');

        startPlaying(ctx, ['a', 'b'], 1);
        ctx.round.submitResult('a', 1, { elapsedMs: 2010 });
        ctx.round.submitResult('b', 1, { elapsedMs: 2400 });

        const final = ctx.resolved.at(-1)!;
        assert.equal(final.isFinal, true);
        assert.equal(final.winnerId, 'a');
    });

    it('draws a winner rather than looping forever on an unbreakable tie', () => {
        ctx.round.begin(['a', 'b']);
        for (let attempt = 0; attempt < SELF_TIMED.MAX_TIEBREAK_ATTEMPTS; attempt++) {
            startPlaying(ctx, ['a', 'b'], attempt);
            ctx.round.submitResult('a', attempt, { elapsedMs: 2100 });
            ctx.round.submitResult('b', attempt, { elapsedMs: 2100 });
            ctx.clock.advance(5_000);
        }
        const final = ctx.resolved.at(-1)!;
        assert.equal(final.isFinal, true);
        assert.equal(final.decidedByCoinFlip, true);
        assert.ok(['a', 'b'].includes(final.winnerId!));
    });

    it('starts without a player who never answers the ready check', () => {
        ctx.round.begin(['a', 'b']);
        ctx.round.markReady('a', 0);
        ctx.clock.advance(SELF_TIMED.READY_CHECK_TIMEOUT_MS + 1);

        assert.equal(ctx.starts.length, 1);
        ctx.clock.advance(SELF_TIMED.START_LEAD_MS);
        ctx.round.submitResult('a', 0, { elapsedMs: 2000 });

        const result = ctx.resolved.at(-1)!;
        assert.equal(result.winnerId, 'a');
        assert.deepEqual(result.noShow, [], 'b was dropped at the ready check');
    });

    it('stops waiting on a player who disconnects, but keeps their result', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);
        ctx.round.submitResult('a', 0, { elapsedMs: 2400 });
        ctx.round.submitResult('b', 0, { elapsedMs: 2050 });
        assert.equal(ctx.resolved.length, 1);

        const second = setup();
        second.round.begin(['a', 'b']);
        startPlaying(second, ['a', 'b']);
        second.round.submitResult('b', 0, { elapsedMs: 2050 });
        second.round.dropParticipant('a');

        const result = second.resolved.at(-1)!;
        assert.equal(result.winnerId, 'b');
        assert.deepEqual(result.noShow, []);
    });

    it('rate limits progress and never lets it reach the outcome', () => {
        ctx.round.begin(['a', 'b']);
        startPlaying(ctx, ['a', 'b']);

        ctx.round.submitProgress('a', 0, { running: true });
        ctx.round.submitProgress('a', 0, { running: true });
        assert.equal(ctx.progress.length, 1, 'progress was not rate limited');

        ctx.clock.advance(SELF_TIMED.PROGRESS_MIN_INTERVAL_MS + 1);
        ctx.round.submitProgress('a', 0, { running: true });
        assert.equal(ctx.progress.length, 2);

        ctx.round.submitProgress('a', 0, { garbage: 1 });
        assert.equal(ctx.progress.length, 2, 'malformed progress was broadcast');
    });

    it('does not accept results before the scheduled start', () => {
        ctx.round.begin(['a', 'b']);
        ctx.round.markReady('a', 0);
        ctx.round.markReady('b', 0);
        const early = ctx.round.submitResult('a', 0, { elapsedMs: 2000 });
        assert.equal(early.ok, false);
        assert.equal(early.ok === false && early.code, 'wrong_phase');
    });
});
