import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { COMPETITION, ROOM, SELF_TIMED } from '../shared/constants';
import { ServerEvent, type RoomStatePayload, type RoundDataPayload, type RoundResultsPayload } from '../shared/protocol';
import { FakeClock } from './clock';
import { Room } from './room';

interface Emitted {
    event: string;
    payload: unknown;
}

const setup = () => {
    const clock = new FakeClock();
    const emitted: Emitted[] = [];
    const direct: (Emitted & { socketId: string })[] = [];
    const room = new Room({
        roomCode: 'TEST',
        clock,
        rng: () => 0,
        emitter: {
            toRoom: (event, payload) => emitted.push({ event, payload }),
            toSocket: (socketId, event, payload) =>
                direct.push({ socketId, event, payload })
        }
    });

    const last = <T>(event: string): T | undefined =>
        [...emitted].reverse().find((e) => e.event === event)?.payload as T | undefined;

    const all = <T>(event: string): T[] =>
        emitted.filter((e) => e.event === event).map((e) => e.payload as T);

    return { clock, room, emitted, direct, last, all };
};

const join = (ctx: ReturnType<typeof setup>, socketId: string, name: string) => {
    const result = ctx.room.join({ socketId, name });
    assert.equal(result.ok, true);
    return result.ok ? result.data.playerId : '';
};

/** Ready everyone, run to the start, and hand back the live round data. */
const reachPlaying = (ctx: ReturnType<typeof setup>, playerIds: string[]) => {
    const data = ctx.last<RoundDataPayload>(ServerEvent.RoundData)!;
    for (const playerId of playerIds) {
        const outcome = ctx.room.markReady(playerId, data.roundId, data.attempt);
        assert.equal(outcome.ok, true);
    }
    ctx.clock.advance(SELF_TIMED.START_LEAD_MS);
    return data;
};

describe('room membership', () => {
    let ctx: ReturnType<typeof setup>;

    beforeEach(() => {
        ctx = setup();
    });

    it('makes the first player the owner', () => {
        const a = join(ctx, 's1', 'A');
        join(ctx, 's2', 'B');
        assert.equal(ctx.last<RoomStatePayload>(ServerEvent.RoomState)!.ownerId, a);
    });

    it('moves ownership to whoever has been connected longest', () => {
        const a = join(ctx, 's1', 'A');
        const b = join(ctx, 's2', 'B');
        join(ctx, 's3', 'C');

        ctx.room.handleDisconnect(a, 's1');
        assert.equal(ctx.last<RoomStatePayload>(ServerEvent.RoomState)!.ownerId, b);
        assert.equal(
            ctx.last<{ ownerId: string }>(ServerEvent.OwnerChanged)!.ownerId,
            b
        );
    });

    it('holds a disconnected slot, then drops it', () => {
        const a = join(ctx, 's1', 'A');
        join(ctx, 's2', 'B');

        ctx.room.handleDisconnect(a, 's1');
        let state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players.length, 2);
        assert.equal(state.players.find((p) => p.playerId === a)?.connected, false);

        ctx.clock.advance(ROOM.DISCONNECT_GRACE_MS + 1);
        state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players.length, 1);
    });

    it('lets a player reclaim their slot with the same playerId', () => {
        const a = join(ctx, 's1', 'A');
        ctx.room.handleDisconnect(a, 's1');

        const back = ctx.room.join({ socketId: 's9', name: 'A', playerId: a });
        assert.equal(back.ok, true);
        assert.equal(back.ok && back.data.reconnected, true);
        assert.equal(back.ok && back.data.playerId, a);

        ctx.clock.advance(ROOM.DISCONNECT_GRACE_MS + 1);
        const state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players.length, 1, 'the drop timer was not cancelled');
        assert.equal(state.players[0]!.connected, true);
    });

    it('ignores a stale socket disconnect after a reconnect claimed the slot', () => {
        const a = join(ctx, 's1', 'A');
        ctx.room.handleDisconnect(a, 's1');
        ctx.room.join({ socketId: 's9', name: 'A', playerId: a });

        ctx.room.handleDisconnect(a, 's1');
        const state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players[0]!.connected, true);
    });

    it('refuses to overfill a room', () => {
        for (let i = 0; i < ROOM.MAX_PLAYERS; i++) join(ctx, `s${i}`, `P${i}`);
        const overflow = ctx.room.join({ socketId: 'sx', name: 'X' });
        assert.equal(overflow.ok, false);
        assert.equal(overflow.ok === false && overflow.code, 'room_full');
    });
});

describe('competition flow', () => {
    let ctx: ReturnType<typeof setup>;
    let a: string;
    let b: string;

    beforeEach(() => {
        ctx = setup();
        a = join(ctx, 's1', 'A');
        b = join(ctx, 's2', 'B');
    });

    const startMatch = () => {
        assert.equal(ctx.room.setMode(a, 'custom', ['stop-the-clock']).ok, true);
        assert.equal(ctx.room.startCompetition(a).ok, true);
    };

    it('only lets the owner choose the playlist and start', () => {
        assert.equal(ctx.room.setMode(b, 'custom', ['stop-the-clock']).ok, false);
        assert.equal(ctx.room.startCompetition(b).ok, false);
    });

    it('will not start below the minimum player count', () => {
        const solo = setup();
        const only = join(solo, 's1', 'A');
        const outcome = solo.room.startCompetition(only);
        assert.equal(outcome.ok, false);
        assert.equal(outcome.ok === false && outcome.code, 'not_enough_players');
    });

    it('plays a game twice, one point per round, then shows the leaderboard', () => {
        startMatch();

        for (let roundNumber = 1; roundNumber <= COMPETITION.ROUNDS_PER_GAME; roundNumber++) {
            const data = reachPlaying(ctx, [a, b]);
            assert.equal(data.roundId, roundNumber);
            // rng is pinned to 0, so the target is always the 2000 ms floor.
            ctx.room.submitResult(a, data.roundId, data.attempt, { elapsedMs: 2000 });
            ctx.room.submitResult(b, data.roundId, data.attempt, { elapsedMs: 2900 });

            const results = ctx.last<RoundResultsPayload>(ServerEvent.RoundResults)!;
            assert.equal(results.isFinal, true);
            assert.equal(results.winnerId, a);
            assert.equal(
                results.scores.find((row) => row.playerId === a)?.points,
                roundNumber
            );
            ctx.clock.advance(COMPETITION.RESULT_DISPLAY_MS + 1);
        }

        const leaderboard = ctx.last<{ rows: { playerId: string; points: number; rank: number }[]; tied: boolean }>(
            ServerEvent.Leaderboard
        )!;
        assert.deepEqual(leaderboard.rows, [
            { playerId: a, points: 2, rank: 1 },
            { playerId: b, points: 0, rank: 2 }
        ]);
        assert.equal(ctx.room.currentPhase, 'leaderboard');
    });

    it('returns to the lobby and clears the competition afterwards', () => {
        startMatch();
        for (let i = 0; i < COMPETITION.ROUNDS_PER_GAME; i++) {
            const data = reachPlaying(ctx, [a, b]);
            ctx.room.submitResult(a, data.roundId, data.attempt, { elapsedMs: 2000 });
            ctx.room.submitResult(b, data.roundId, data.attempt, { elapsedMs: 2900 });
            ctx.clock.advance(COMPETITION.RESULT_DISPLAY_MS + 1);
        }
        ctx.clock.advance(COMPETITION.LEADERBOARD_DISPLAY_MS + 1);

        assert.equal(ctx.room.currentPhase, 'lobby');
        const state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.phase, 'lobby');
        assert.equal(state.round.phase, 'idle');
        assert.equal(state.players.every((p) => p.points === 0), true);
    });

    it('throws away a message tagged with an old roundId', () => {
        startMatch();
        const data = reachPlaying(ctx, [a, b]);
        const stale = ctx.room.submitResult(a, data.roundId - 1, data.attempt, {
            elapsedMs: 2000
        });
        assert.equal(stale.ok, false);
        assert.equal(stale.ok === false && stale.code, 'stale_round');
    });

    it('makes a mid-competition joiner a spectator until the next lobby', () => {
        startMatch();
        const c = join(ctx, 's3', 'C');
        let state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players.find((p) => p.playerId === c)?.isSpectator, true);

        const data = ctx.last<RoundDataPayload>(ServerEvent.RoundData)!;
        assert.equal(data.participants.includes(c), false);

        for (let i = 0; i < COMPETITION.ROUNDS_PER_GAME; i++) {
            const round = reachPlaying(ctx, [a, b]);
            ctx.room.submitResult(a, round.roundId, round.attempt, { elapsedMs: 2000 });
            ctx.room.submitResult(b, round.roundId, round.attempt, { elapsedMs: 2900 });
            ctx.clock.advance(COMPETITION.RESULT_DISPLAY_MS + 1);
        }
        ctx.clock.advance(COMPETITION.LEADERBOARD_DISPLAY_MS + 1);

        state = ctx.last<RoomStatePayload>(ServerEvent.RoomState)!;
        assert.equal(state.players.find((p) => p.playerId === c)?.isSpectator, false);
    });

    it('finishes the round without a player who disconnects mid-round', () => {
        startMatch();
        const data = reachPlaying(ctx, [a, b]);
        ctx.room.submitResult(a, data.roundId, data.attempt, { elapsedMs: 2400 });
        ctx.room.handleDisconnect(b, 's2');

        const results = ctx.last<RoundResultsPayload>(ServerEvent.RoundResults)!;
        assert.equal(results.isFinal, true);
        assert.equal(results.winnerId, a);
    });

    it('lets the owner skip the results screen', () => {
        startMatch();
        const data = reachPlaying(ctx, [a, b]);
        ctx.room.submitResult(a, data.roundId, data.attempt, { elapsedMs: 2000 });
        ctx.room.submitResult(b, data.roundId, data.attempt, { elapsedMs: 2900 });

        assert.equal(ctx.room.skipResults(b).ok, false, 'only the owner may skip');
        assert.equal(ctx.room.skipResults(a).ok, true);

        const next = ctx.last<RoundDataPayload>(ServerEvent.RoundData)!;
        assert.equal(next.roundId, data.roundId + 1);
    });

    it('sends a reconnecting client the round data it missed', () => {
        startMatch();
        reachPlaying(ctx, [a, b]);
        ctx.room.handleDisconnect(b, 's2');
        ctx.direct.length = 0;

        ctx.room.join({ socketId: 's22', name: 'B', playerId: b });
        const sent = ctx.direct.filter((e) => e.event === ServerEvent.RoundData);
        assert.equal(sent.length, 1);
        assert.equal(sent[0]!.socketId, 's22');
    });

    it('does not put hidden results in the room state', () => {
        startMatch();
        const data = reachPlaying(ctx, [a, b]);
        ctx.room.submitResult(a, data.roundId, data.attempt, { elapsedMs: 2000 });

        const state = JSON.stringify(ctx.room.getState());
        assert.equal(
            state.includes('elapsedMs'),
            false,
            'a reported time leaked before the reveal'
        );
    });
});
