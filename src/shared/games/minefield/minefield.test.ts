import test from 'node:test';
import assert from 'node:assert/strict';
import type { RandomSource } from '../random';
import { MINEFIELD } from './constants';
import { densityAt, generateMap, hasSafeRoute } from './map';
import { minefieldModule } from './module';
import { parseMinefieldProgress, parseMinefieldResult } from './parsing';
import { isScanShowing, minesInSonarRange, revealedMines, simulateRace, simulateRun } from './simulate';
import type { Input, MinefieldMap, Mine } from './types';

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

const mapWith = (mines: Mine[]): MinefieldMap => ({
    width: MINEFIELD.WIDTH,
    height: MINEFIELD.HEIGHT,
    startX: MINEFIELD.START_X,
    startY: MINEFIELD.START_Y,
    finishX: MINEFIELD.FINISH_X,
    mines
});

const right: Input = { kind: 'move', atMs: 0, dx: 1, dy: 0 };
const stop = (atMs: number): Input => ({ kind: 'move', atMs, dx: 0, dy: 0 });
const sonar = (atMs: number): Input => ({ kind: 'sonar', atMs });

/** How long a straight run to the line takes on an empty field. */
const CLEAR_RUN_MS =
    ((MINEFIELD.FINISH_X - MINEFIELD.START_X) / MINEFIELD.SPEED_TILES_PER_S) * 1000;

/* ---------------- running ---------------- */

test('running straight to the finish line on an empty field takes distance / speed', () => {
    const outcome = simulateRun(mapWith([]), [right]);
    assert.ok(outcome.finishedAtMs !== null);
    assert.ok(Math.abs(outcome.finishedAtMs - CLEAR_RUN_MS) <= MINEFIELD.STEP_MS * 2);
    assert.equal(outcome.livesLeft, MINEFIELD.LIVES);
    assert.equal(outcome.eliminatedAtMs, null);
});

test('a runner who never moves never finishes and is not hurt', () => {
    const outcome = simulateRun(mapWith([]), []);
    assert.equal(outcome.finishedAtMs, null);
    assert.equal(outcome.x, MINEFIELD.START_X);
});

test('diagonal movement is no faster than straight', () => {
    const straight = simulateRun(mapWith([]), [right], 2_000);
    const diagonal = simulateRun(
        mapWith([]),
        [{ kind: 'move', atMs: 0, dx: 1, dy: 1 }],
        2_000
    );
    const travelled = Math.hypot(diagonal.x - MINEFIELD.START_X, diagonal.y - MINEFIELD.START_Y);
    assert.ok(Math.abs(travelled - (straight.x - MINEFIELD.START_X)) < 0.05);
});

test('the runner cannot leave the field', () => {
    const outcome = simulateRun(
        mapWith([]),
        [{ kind: 'move', atMs: 0, dx: -1, dy: -1 }],
        20_000
    );
    assert.ok(outcome.x >= 0.5 && outcome.y >= 0.5);
});

test('releasing the keys stops the runner', () => {
    const outcome = simulateRun(mapWith([]), [right, stop(1_000)], 5_000);
    assert.ok(Math.abs(outcome.x - (MINEFIELD.START_X + 4)) < 0.1);
});

test('the same inputs always give the same result', () => {
    const map = generateMap(seededRandom(1));
    const inputs: Input[] = [right, sonar(500), stop(3_000)];
    assert.deepEqual(simulateRun(map, inputs), simulateRun(map, inputs));
});

/* ---------------- mines and lives ---------------- */

test('walking into a mine costs a life, the mine is gone, and the runner is held for the explosion', () => {
    const mine = { x: 10, y: MINEFIELD.START_Y };
    const outcome = simulateRun(mapWith([mine]), [right], 20_000);

    assert.equal(outcome.detonations.length, 1);
    assert.equal(outcome.livesLeft, MINEFIELD.LIVES - 1);
    assert.equal(outcome.eliminatedAtMs, null);

    // It goes off at the edge of the trigger radius, not at the centre.
    const hitAt = outcome.detonations[0]!.atMs;
    const expectedX = mine.x - MINEFIELD.TRIGGER_RADIUS;
    const hitX = MINEFIELD.START_X + (hitAt / 1000) * MINEFIELD.SPEED_TILES_PER_S;
    assert.ok(Math.abs(hitX - expectedX) < 0.1);
});

test('the runner stands still for the explosion animation, then carries on', () => {
    const outcome = simulateRun(mapWith([{ x: 10, y: MINEFIELD.START_Y }]), [right], 20_000);
    const hitAt = outcome.detonations[0]!.atMs;

    const during = simulateRun(
        mapWith([{ x: 10, y: MINEFIELD.START_Y }]),
        [right],
        hitAt + MINEFIELD.EXPLOSION_ANIMATION_MS - MINEFIELD.STEP_MS * 2
    );
    const atHit = simulateRun(mapWith([{ x: 10, y: MINEFIELD.START_Y }]), [right], hitAt);
    assert.ok(Math.abs(during.x - atHit.x) < 1e-9, 'still while the explosion plays');
    assert.ok(outcome.x > atHit.x + 1, 'moving again afterwards');
});

test('a mine that has gone off is gone for good', () => {
    const outcome = simulateRun(
        mapWith([{ x: 10, y: MINEFIELD.START_Y }]),
        [right, stop(2_500), { kind: 'move', atMs: 4_000, dx: -1, dy: 0 }, { kind: 'move', atMs: 5_500, dx: 1, dy: 0 }],
        15_000
    );
    assert.equal(outcome.detonations.length, 1);
});

test('the second mine ends the race', () => {
    const mines = [
        { x: 10, y: MINEFIELD.START_Y },
        { x: 20, y: MINEFIELD.START_Y }
    ];
    const outcome = simulateRun(mapWith(mines), [right], 30_000);
    assert.equal(outcome.detonations.length, 2);
    assert.equal(outcome.livesLeft, 0);
    assert.equal(outcome.eliminatedAtMs, outcome.detonations[1]!.atMs);
    assert.equal(outcome.finishedAtMs, null);
});

test('a cluster cannot take both lives in one go: a blast protects the runner for a moment', () => {
    // Two mines 1 tile apart, on the way.
    const mines = [
        { x: 10, y: MINEFIELD.START_Y },
        { x: 11, y: MINEFIELD.START_Y }
    ];
    const outcome = simulateRun(mapWith(mines), [right], 30_000);
    const [first, second] = outcome.detonations;
    assert.ok(first !== undefined);
    // Held still for the explosion, the runner is still inside the second mine's radius when the
    // protection ends, so it goes off then and not before.
    if (second !== undefined) {
        assert.ok(second.atMs - first.atMs >= MINEFIELD.INVULNERABLE_MS);
    }
});

test('a mine well off to the side is harmless', () => {
    const outcome = simulateRun(
        mapWith([{ x: 20, y: MINEFIELD.START_Y + MINEFIELD.TRIGGER_RADIUS + 0.2 }]),
        [right]
    );
    assert.equal(outcome.detonations.length, 0);
    assert.ok(outcome.finishedAtMs !== null);
});

test('a mine in the way can be dodged by steering round it', () => {
    const mine = { x: 20, y: MINEFIELD.START_Y };
    const dodge: Input[] = [
        right,
        { kind: 'move', atMs: 3_500, dx: 0, dy: 1 },
        { kind: 'move', atMs: 4_700, dx: 1, dy: 0 }
    ];
    const outcome = simulateRun(mapWith([mine]), dodge);
    assert.equal(outcome.detonations.length, 0);
    assert.ok(outcome.finishedAtMs !== null);
});

/* ---------------- shared mines ---------------- */

const shifted = (dy: number, startMs: number): Input[] => [
    { kind: 'move', atMs: startMs, dx: 0, dy: dy > 0 ? 1 : -1 },
    { kind: 'move', atMs: startMs + Math.round((Math.abs(dy) / MINEFIELD.SPEED_TILES_PER_S) * 1000), dx: 1, dy: 0 }
];

test('two runners inside a mine\'s radius when it goes off are both hit by it', () => {
    const map = mapWith([{ x: 10, y: MINEFIELD.START_Y + 0.2 }]);
    const race = simulateRace(map, [
        // b steps aside first while a waits, so the two stay level as they run.
        { playerId: 'a', inputs: [{ ...right, atMs: 100 }] },
        { playerId: 'b', inputs: shifted(0.4, 0) }
    ]);
    assert.equal(race.explosions.length, 1);
    for (const id of ['a', 'b']) {
        const outcome = race.outcomes.get(id)!;
        assert.equal(outcome.livesLeft, MINEFIELD.LIVES - 1, id);
        assert.equal(outcome.detonations.length, 1, id);
        assert.equal(outcome.detonations[0]!.atMs, race.explosions[0]!.atMs, id);
    }
});

test('a runner outside the radius when it goes off is not hurt', () => {
    const map = mapWith([{ x: 10, y: MINEFIELD.START_Y }]);
    const race = simulateRace(map, [
        { playerId: 'a', inputs: [right] },
        // Running alongside, but a tile further over: out of reach.
        { playerId: 'b', inputs: shifted(1.2, 0) }
    ]);
    assert.equal(race.outcomes.get('a')!.detonations.length, 1);
    assert.equal(race.outcomes.get('b')!.detonations.length, 0);
    assert.equal(race.outcomes.get('b')!.livesLeft, MINEFIELD.LIVES);
});

test('a mine goes off only once: a runner who arrives after it has gone is not hurt', () => {
    const map = mapWith([{ x: 10, y: MINEFIELD.START_Y }]);
    const race = simulateRace(map, [
        { playerId: 'first', inputs: [right] },
        { playerId: 'second', inputs: [{ ...right, atMs: 2_000 }] }
    ]);
    assert.equal(race.explosions.length, 1);
    assert.equal(race.outcomes.get('first')!.livesLeft, MINEFIELD.LIVES - 1);
    assert.equal(race.outcomes.get('second')!.livesLeft, MINEFIELD.LIVES);
});

test('a runner following another through the field is spared the mines the leader set off', () => {
    const map = mapWith([10, 14].map((x) => ({ x, y: MINEFIELD.START_Y })));
    const alone = simulateRun(map, [{ ...right, atMs: 5_000 }]);
    assert.equal(alone.livesLeft, 0, 'on their own the follower would have been knocked out');

    const race = simulateRace(map, [
        { playerId: 'leader', inputs: [right] },
        { playerId: 'follower', inputs: [{ ...right, atMs: 5_000 }] }
    ]);
    assert.equal(race.outcomes.get('leader')!.livesLeft, 0);
    assert.equal(race.outcomes.get('follower')!.livesLeft, MINEFIELD.LIVES);
    assert.deepEqual(race.winners, ['follower']);
});

test('every mine appears in the explosions at most once', () => {
    for (let seed = 1; seed <= 20; seed++) {
        const map = generateMap(seededRandom(seed));
        const race = simulateRace(map, [
            { playerId: 'a', inputs: [right] },
            { playerId: 'b', inputs: [{ ...right, atMs: 700 }] },
            { playerId: 'c', inputs: shifted(2, 0) }
        ]);
        const mineIndexes = race.explosions.map((e) => e.mineIndex);
        assert.equal(new Set(mineIndexes).size, mineIndexes.length, `seed ${seed}`);
    }
});

test('the result does not depend on the order the runners are listed in', () => {
    for (let seed = 1; seed <= 15; seed++) {
        const map = generateMap(seededRandom(seed));
        const runners = [
            { playerId: 'a', inputs: [right] },
            { playerId: 'b', inputs: shifted(1, 0) },
            { playerId: 'c', inputs: [{ ...right, atMs: 300 }, sonar(1_000)] }
        ];
        const forward = simulateRace(map, runners);
        const backward = simulateRace(map, [...runners].reverse());
        assert.deepEqual([...forward.outcomes], [...backward.outcomes], `seed ${seed}`);
        assert.deepEqual(forward.explosions, backward.explosions);
    }
});

test('the race stops when someone finishes: later explosions do not count', () => {
    const map = mapWith([{ x: 52, y: MINEFIELD.START_Y }]);
    const race = simulateRace(map, [
        { playerId: 'fast', inputs: [{ kind: 'move', atMs: 0, dx: 1, dy: -1 }, { kind: 'move', atMs: 1_800, dx: 1, dy: 0 }] },
        { playerId: 'slow', inputs: [{ ...right, atMs: 5_000 }] }
    ]);
    assert.deepEqual(race.winners, ['fast']);
    assert.equal(race.endedAtMs, race.outcomes.get('fast')!.finishedAtMs);
    assert.equal(race.explosions.length, 0);
});

/* ---------------- sonar ---------------- */

test('sonar roots the runner while the scan animation plays', () => {
    const baseline = simulateRun(mapWith([]), [right], 3_000);
    const scanned = simulateRun(mapWith([]), [right, sonar(1_000)], 3_000);
    const lost = (baseline.x - scanned.x) / MINEFIELD.SPEED_TILES_PER_S;
    assert.ok(Math.abs(lost * 1000 - MINEFIELD.SONAR_ANIMATION_MS) < MINEFIELD.STEP_MS * 2);
    assert.equal(scanned.scans.length, 1);
});

test('sonar presses during the cooldown do nothing', () => {
    const outcome = simulateRun(
        mapWith([]),
        [right, sonar(1_000), sonar(1_000 + MINEFIELD.SONAR_COOLDOWN_MS - 100)],
        10_000
    );
    assert.equal(outcome.scans.length, 1);

    const again = simulateRun(
        mapWith([]),
        [right, sonar(1_000), sonar(1_000 + MINEFIELD.SONAR_COOLDOWN_MS + 50)],
        10_000
    );
    assert.equal(again.scans.length, 2);
});

test('mashing sonar does not beat holding still: each scan costs time and recharges slowly', () => {
    const mash: Input[] = [right, ...Array.from({ length: 40 }, (_, i) => sonar(i * 200))];
    const outcome = simulateRun(mapWith([]), mash, 6_000);
    assert.ok(outcome.scans.length <= 2);
});

test('sonar shows the mines within range and only those', () => {
    const map = mapWith([
        { x: 10, y: 7.5 },
        { x: 13, y: 7.5 },
        { x: 10 + MINEFIELD.SONAR_RADIUS + 0.5, y: 7.5 },
        { x: 10, y: 7.5 + MINEFIELD.SONAR_RADIUS + 0.5 }
    ]);
    assert.deepEqual(minesInSonarRange(map, 10, 7.5), [0, 1]);
    assert.deepEqual(minesInSonarRange(map, 10, 7.5, new Set([0])), [1]);
});

test('a scan records where the runner stood, so others can be shown what it found', () => {
    const outcome = simulateRun(mapWith([]), [right, stop(1_000), sonar(1_500)], 4_000);
    assert.equal(outcome.scans.length, 1);
    const [scan] = outcome.scans;
    assert.equal(scan!.atMs, 1_504); // the first step on or after 1500 ms
    assert.ok(Math.abs(scan!.x - (MINEFIELD.START_X + 4)) < 0.1);
    assert.equal(scan!.y, MINEFIELD.START_Y);
});

test('sonar is shared: a scan by one runner shows its mines to everyone, for a limited time', () => {
    const mines = [{ x: 20, y: 7.5 }, { x: 22, y: 9 }, { x: 40, y: 7.5 }];
    const map = mapWith(mines);
    const scan = { atMs: 5_000, x: 20, y: 7.5 };

    // Not showing while the scan animation is still playing.
    assert.deepEqual(revealedMines(map, [scan], 5_000 + MINEFIELD.SONAR_ANIMATION_MS - 1), []);
    // Then everything within range of where *they* stood, wherever the viewer is.
    const shows = 5_000 + MINEFIELD.SONAR_ANIMATION_MS;
    assert.deepEqual(revealedMines(map, [scan], shows), [0, 1]);
    // ...for the reveal time, then it fades.
    assert.equal(isScanShowing(scan, shows + MINEFIELD.SONAR_REVEAL_MS - 1), true);
    assert.deepEqual(revealedMines(map, [scan], shows + MINEFIELD.SONAR_REVEAL_MS), []);
});

test('scans from several runners add up, and mines that have gone off are never shown', () => {
    const map = mapWith([{ x: 20, y: 7.5 }, { x: 40, y: 7.5 }]);
    const scans = [
        { atMs: 5_000, x: 20, y: 7.5 },
        { atMs: 5_500, x: 40, y: 7.5 }
    ];
    const now = 5_500 + MINEFIELD.SONAR_ANIMATION_MS;
    assert.deepEqual(revealedMines(map, scans, now), [0, 1]);
    assert.deepEqual(revealedMines(map, scans, now, new Set([0])), [1]);
});

/* ---------------- the field ---------------- */

test('generated fields keep the start and finish clear and mines apart', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const map = generateMap(seededRandom(seed));
        assert.ok(map.mines.length > 20, `seed ${seed}: ${map.mines.length}`);
        for (const mine of map.mines) {
            assert.ok(mine.x >= MINEFIELD.START_SAFE_TILES, `seed ${seed}`);
            assert.ok(mine.x <= MINEFIELD.FINISH_X - MINEFIELD.FINISH_SAFE_TILES, `seed ${seed}`);
            assert.ok(mine.y >= 0.5 && mine.y <= MINEFIELD.HEIGHT - 0.5);
        }
        for (const [i, a] of map.mines.entries()) {
            for (const b of map.mines.slice(i + 1)) {
                assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= MINEFIELD.MIN_MINE_SPACING - 0.02);
            }
        }
    }
});

test('every generated field can be crossed without setting off a mine', () => {
    for (let seed = 1; seed <= 40; seed++) {
        assert.ok(hasSafeRoute(generateMap(seededRandom(seed))), `seed ${seed}`);
    }
});

test('the route check really does notice a wall of mines', () => {
    const wall: Mine[] = Array.from({ length: 16 }, (_, i) => ({ x: 20, y: i + 0.5 }));
    assert.equal(hasSafeRoute(mapWith(wall)), false);
    assert.equal(hasSafeRoute(mapWith([])), true);
});

test('the field gets denser towards the finish', () => {
    assert.ok(densityAt(MINEFIELD.FINISH_X - 4) > densityAt(MINEFIELD.START_SAFE_TILES + 1));
    let near = 0;
    let far = 0;
    for (let seed = 1; seed <= 30; seed++) {
        for (const mine of generateMap(seededRandom(seed)).mines) {
            if (mine.x < MINEFIELD.WIDTH / 2) near++;
            else far++;
        }
    }
    assert.ok(far > near * 1.3, `${near} near vs ${far} far`);
});

test('every round gets its own field', () => {
    const context = { roundInGame: 1, roundsPerGame: 2, playerIds: ['a'], attempt: 0 };
    const first = minefieldModule.createRoundData(context);
    const second = minefieldModule.createRoundData({ ...context, roundInGame: 2 });
    assert.notDeepEqual(first.map.mines, second.map.mines);
});

/* ---------------- ranking ---------------- */

const clearMap = mapWith([]);
const roundOf = (map: MinefieldMap) => ({ map });
const resultOf = (inputs: Input[]) => ({ inputs, timingSuspect: false });

const ranksOf = (rows: { playerId: string; rank: number }[]) =>
    rows.map((row) => [row.playerId, row.rank]);

test('the first across the line wins and everyone else loses, however they were doing', () => {
    const ranked = minefieldModule.rank(
        [
            { playerId: 'slow', result: resultOf([{ ...right, atMs: 1_000 }]) },
            { playerId: 'fast', result: resultOf([right]) }
        ],
        roundOf(clearMap)
    );
    assert.deepEqual(ranksOf(ranked), [['fast', 1], ['slow', 2]]);
    assert.equal(ranked[0]!.detail.finished, true);
    assert.equal(ranked[1]!.detail.finished, false);
});

test('only the first finisher wins: a second finisher after them still loses', () => {
    const ranked = minefieldModule.rank(
        [
            { playerId: 'a', result: resultOf([right]) },
            { playerId: 'b', result: resultOf([{ ...right, atMs: 500 }]) }
        ],
        roundOf(clearMap)
    );
    assert.deepEqual(ranksOf(ranked), [['a', 1], ['b', 2]]);
    // b would have finished too, but the race ended first.
    assert.equal(ranked[1]!.detail.finished, false);
    assert.equal(ranked[1]!.detail.raceEndedAtMs, ranked[0]!.detail.finishedAtMs);
});

test('a runner who was knocked out loses to one still running when the race ended', () => {
    const mines = [
        { x: 10, y: MINEFIELD.START_Y },
        { x: 14, y: MINEFIELD.START_Y }
    ];
    const ranked = minefieldModule.rank(
        [
            { playerId: 'winner', result: resultOf([{ kind: 'move', atMs: 0, dx: 1, dy: -1 }, { kind: 'move', atMs: 3_000, dx: 1, dy: 0 }]) },
            { playerId: 'dead', result: resultOf([right]) },
            { playerId: 'stuck', result: resultOf([]) }
        ],
        roundOf(mapWith(mines))
    );
    assert.equal(ranked[0]!.playerId, 'winner');
    const order = ranked.map((row) => row.playerId);
    assert.ok(order.indexOf('stuck') < order.indexOf('dead'));
});

test('among those still running when the race ends, the furthest ahead ranks higher', () => {
    const ranked = minefieldModule.rank(
        [
            { playerId: 'winner', result: resultOf([right]) },
            { playerId: 'near', result: resultOf([{ ...right, atMs: 3_000 }]) },
            { playerId: 'far', result: resultOf([{ ...right, atMs: 500 }]) }
        ],
        roundOf(clearMap)
    );
    assert.deepEqual(ranked.map((r) => r.playerId), ['winner', 'far', 'near']);
});

test('if nobody finishes, the player who got furthest wins', () => {
    const ranked = minefieldModule.rank(
        [
            { playerId: 'a', result: resultOf([right, stop(2_000)]) },
            { playerId: 'b', result: resultOf([right, stop(5_000)]) }
        ],
        roundOf(clearMap)
    );
    assert.deepEqual(ranksOf(ranked), [['b', 1], ['a', 2]]);
});

test('if everybody is knocked out, whoever lasted longest wins', () => {
    const mines = [10, 14, 18, 22].map((x) => ({ x, y: MINEFIELD.START_Y }));
    const ranked = minefieldModule.rank(
        [
            // Takes the first two mines and is out.
            { playerId: 'early', result: resultOf([right]) },
            // Starts later, finds those two gone, and falls to the last two.
            { playerId: 'late', result: resultOf([{ ...right, atMs: 3_000 }]) }
        ],
        roundOf(mapWith(mines))
    );
    assert.deepEqual(ranksOf(ranked), [['late', 1], ['early', 2]]);
    assert.ok(ranked.every((row) => row.detail.livesLeft === 0 && row.detail.finished === false));
});

test('two players who cross on the very same step tie for the tiebreaker', () => {
    const ranked = minefieldModule.rank(
        [
            { playerId: 'a', result: resultOf([right]) },
            { playerId: 'b', result: resultOf([right]) }
        ],
        roundOf(clearMap)
    );
    assert.deepEqual(ranked.map((r) => r.rank), [1, 1]);
});

test('a claimed finish that the replay does not support does not count', () => {
    // The client "reports" nothing but a stop; it never moved, so it cannot have finished.
    const ranked = minefieldModule.rank(
        [{ playerId: 'liar', result: resultOf([stop(10)]) }],
        roundOf(clearMap)
    );
    assert.equal(ranked[0]!.detail.finished, false);
});

/* ---------------- the round ---------------- */

test('once a player has finished, the others are told to stop and report', () => {
    const round = roundOf(clearMap);
    const finished = resultOf([right]);
    const racing = resultOf([stop(0)]);
    assert.equal(minefieldModule.shouldCloseEarly?.([racing], 3, round), false);
    assert.equal(minefieldModule.shouldCloseEarly?.([racing, finished], 3, round), true);
});

test('the timing and the animation lengths', () => {
    assert.equal(minefieldModule.roundsPerGame, 2);
    assert.equal(minefieldModule.finishAnimationMs, MINEFIELD.FINISH_ANIMATION_MS);
    assert.equal(MINEFIELD.FINISH_ANIMATION_MS, 5_000);
    assert.equal(MINEFIELD.SONAR_ANIMATION_MS, 900);
    assert.equal(minefieldModule.resultTimeoutMs(roundOf(clearMap)), MINEFIELD.MAX_RACE_MS + MINEFIELD.RESULT_GRACE_MS);
});

/* ---------------- parsing ---------------- */

test('a well-formed result parses', () => {
    assert.deepEqual(
        parseMinefieldResult({
            inputs: [
                { kind: 'move', atMs: 0, dx: 1, dy: -1 },
                { kind: 'sonar', atMs: 1200.4 }
            ],
            timingSuspect: true
        }),
        {
            inputs: [
                { kind: 'move', atMs: 0, dx: 1, dy: -1 },
                { kind: 'sonar', atMs: 1200 }
            ],
            timingSuspect: true
        }
    );
});

test('malformed results are rejected', () => {
    const bad: unknown[] = [
        null,
        {},
        { inputs: 'no' },
        { inputs: [{ kind: 'jump', atMs: 1 }] },
        { inputs: [{ kind: 'move', atMs: 1, dx: 2, dy: 0 }] },
        { inputs: [{ kind: 'move', atMs: 1, dx: 0 }] },
        { inputs: [{ kind: 'sonar', atMs: -1 }] },
        { inputs: [{ kind: 'sonar', atMs: MINEFIELD.MAX_RACE_MS + 1 }] },
        { inputs: [{ kind: 'sonar', atMs: NaN }] },
        { inputs: [{ kind: 'sonar', atMs: 2000 }, { kind: 'sonar', atMs: 1000 }] },
        { inputs: Array.from({ length: MINEFIELD.MAX_INPUTS + 1 }, () => ({ kind: 'sonar', atMs: 1 })) }
    ];
    for (const raw of bad) assert.equal(parseMinefieldResult(raw), null, JSON.stringify(raw)?.slice(0, 60));
});

test('progress accepts position, lives and status in range and nothing else', () => {
    const ok = { x: 123, lives: 1, status: 0, mine: 4, scans: 2, scanX: 100, scanY: 70 };
    assert.deepEqual(parseMinefieldProgress(ok, 50), ok);
    // The sonar and mine fields are optional.
    assert.deepEqual(parseMinefieldProgress({ x: 1, lives: 1, status: 0 }, 50), {
        x: 1, lives: 1, status: 0, mine: 0, scans: 0, scanX: 0, scanY: 0
    });
    assert.equal(parseMinefieldProgress({ ...ok, scanX: 601 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, scanY: 151 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, scans: 1_000 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, scans: 1.5 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, x: 601 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, lives: 3 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, status: 3 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, x: 1.5 }, 50), null);
    assert.equal(parseMinefieldProgress({ ...ok, mine: 51 }, 50), null);
    assert.equal(parseMinefieldProgress(null, 50), null);
});
