import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { SelfTimedRound, type AttemptResolved } from './selfTimedRound';
import { SELF_TIMED } from '../shared/constants';
import { CRUSHER_ESCALATOR } from '../shared/games/crusherEscalator/constants';
import { crusherEscalatorModule } from '../shared/games/crusherEscalator/module';
import type { CrusherEscalatorRound } from '../shared/games/crusherEscalator/types';
import { directionAt } from '../shared/games/crusherEscalator/stream';
import type { RoundDataPayload, StartAtPayload } from '../shared/protocol';

const PLAYERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];

/** Presses that are all right for this player's stream, one every 100 ms. */
const perfectPresses = (stream: readonly CrusherEscalatorRound['streams'][string][number][], count: number) =>
    Array.from({ length: count }, (_, i) => ({
        direction: directionAt(stream, i),
        atMs: (i + 1) * 100
    }));

test('8 players: heats, a 3 s pause, then a 6-player final with a shorter run-up', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const roundData: RoundDataPayload<CrusherEscalatorRound>[] = [];
        const starts: StartAtPayload[] = [];
        const resolved: AttemptResolved[] = [];
        const noop = () => {};

        const round = new SelfTimedRound({
            module: crusherEscalatorModule,
            gameId: 'crusher-escalator',
            roundId: 1,
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1,
            roundsPerGame: 2,
            events: {
                onRoundData: (p) => roundData.push(p as RoundDataPayload<CrusherEscalatorRound>),
                onReadyState: noop,
                onStartAt: (p) => starts.push(p),
                onProgress: noop,
                onAttemptResolved: (p) => resolved.push(p)
            }
        });
        round.begin(PLAYERS);

        // Attempt 0 is the heats.
        const heats = roundData[0]!.data;
        assert.equal(heats.stage, 'heats');
        assert.deepEqual(heats.groups.map((g) => g.length), [4, 4]);

        for (const id of PLAYERS) round.markReady(id, 0);
        // The heats get the usual countdown plus 4 s for the heat animation.
        assert.equal(
            starts[0]!.countdownMs,
            SELF_TIMED.COUNTDOWN_MS + CRUSHER_ESCALATOR.HEATS_EXTRA_ANIMATION_MS
        );
        mock.timers.tick(SELF_TIMED.START_LEAD_MS);
        mock.timers.tick(starts[0]!.countdownMs);

        // Heat one: its third player never scores and is crushed first.
        // Heat two: its fourth player stalls after 3 points and is crushed later.
        // That leaves exactly 6 players alive, so the heats end there.
        const [heatOne, heatTwo] = heats.groups as [string[], string[]];
        const stalledEarly = heatOne[2]!;
        const stalledLater = heatTwo[3]!;
        for (const id of PLAYERS) {
            const stream = heats.streams[id]!;
            const pressCount = id === stalledEarly ? 0 : id === stalledLater ? 3 : 14;
            round.submitResult(id, 0, { inputs: perfectPresses(stream, pressCount) });
        }

        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]!.isFinal, false);
        assert.equal(resolved[0]!.stageBreakMs, CRUSHER_ESCALATOR.FINAL_PAUSE_MS);
        assert.equal(resolved[0]!.advancing?.length, CRUSHER_ESCALATOR.FINALISTS);
        assert.ok(!resolved[0]!.advancing?.includes(stalledEarly));
        assert.ok(!resolved[0]!.advancing?.includes(stalledLater));

        // Nothing loads until the pause is over.
        assert.equal(roundData.length, 1);
        mock.timers.tick(CRUSHER_ESCALATOR.FINAL_PAUSE_MS);
        assert.equal(roundData.length, 2);

        const final = roundData[1]!;
        assert.equal(final.attempt, 1);
        assert.equal(final.data.stage, 'final');
        assert.equal(final.data.groups.length, 1);
        assert.equal(final.isTiebreak, false);

        // The final uses its own, shorter run-up.
        for (const id of final.participants) round.markReady(id, 1);
        assert.equal(starts.length, 2);
        assert.equal(starts[1]!.countdownMs, CRUSHER_ESCALATOR.FINAL_COUNTDOWN_MS);

        round.cancel();
    } finally {
        mock.timers.reset();
    }
});
