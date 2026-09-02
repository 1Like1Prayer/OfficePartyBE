import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COMPETITION } from '../shared/constants';
import {
    buildCustomPlaylist,
    buildRandomPlaylist,
    Competition
} from './competition';
import { playableGameIds } from './registry';

describe('playlists', () => {
    it('random picks distinct playable games, capped at the playlist size', () => {
        const playlist = buildRandomPlaylist(() => 0.5);
        assert.ok(playlist.length > 0);
        assert.ok(playlist.length <= COMPETITION.RANDOM_PLAYLIST_SIZE);
        assert.ok(playlist.length <= playableGameIds().length);
        assert.equal(new Set(playlist).size, playlist.length);
        for (const gameId of playlist) {
            assert.ok(playableGameIds().includes(gameId));
        }
    });

    it('custom keeps the owner order and rejects games that are not built', () => {
        assert.deepEqual(buildCustomPlaylist(['stop-the-clock']), ['stop-the-clock']);
        assert.ok(!Array.isArray(buildCustomPlaylist(['blade-arena'])));
        assert.ok(!Array.isArray(buildCustomPlaylist([])));
        assert.ok(
            !Array.isArray(buildCustomPlaylist(['stop-the-clock', 'stop-the-clock'])),
            'duplicates should be rejected'
        );
    });
});

describe('competition', () => {
    const newCompetition = () =>
        new Competition('custom', ['stop-the-clock'], ['a', 'b']);

    it('plays each game twice and awards one point per round', () => {
        const competition = newCompetition();

        assert.deepEqual(competition.position(), {
            gameId: 'stop-the-clock',
            gameIndex: 1,
            totalGames: 1,
            roundInGame: 1
        });
        competition.award('a');
        assert.equal(competition.advance(), true);
        assert.equal(competition.position()?.roundInGame, 2);

        competition.award('a');
        assert.equal(competition.advance(), false, 'one game is two rounds');
        assert.equal(competition.finished, true);
        assert.equal(competition.position(), null);

        assert.deepEqual(competition.scoreRows(), [
            { playerId: 'a', points: 2 },
            { playerId: 'b', points: 0 }
        ]);
    });

    it('increments roundId once per scoring round', () => {
        const competition = newCompetition();
        assert.equal(competition.nextRoundId(), 1);
        assert.equal(competition.nextRoundId(), 2);
        assert.equal(competition.roundId, 2);
    });

    it('awards nothing for a round with no winner', () => {
        const competition = newCompetition();
        competition.award(null);
        assert.deepEqual(competition.scoreRows(), [
            { playerId: 'a', points: 0 },
            { playerId: 'b', points: 0 }
        ]);
    });

    it('puts a late joiner on the table at zero', () => {
        const competition = newCompetition();
        competition.ensurePlayer('c');
        competition.award('a');
        competition.ensurePlayer('a');
        assert.equal(
            competition.scoreRows().find((row) => row.playerId === 'a')?.points,
            1,
            'ensurePlayer must not reset an existing score'
        );
        assert.equal(competition.scoreRows().length, 3);
    });

    it('leaves tied final scores tied', () => {
        const competition = new Competition('custom', ['stop-the-clock'], ['a', 'b', 'c']);
        competition.award('a');
        competition.award('b');

        const leaderboard = competition.leaderboard();
        assert.equal(leaderboard.tied, true);
        assert.deepEqual(
            leaderboard.rows.map((row) => [row.playerId, row.points, row.rank]),
            [
                ['a', 1, 1],
                ['b', 1, 1],
                ['c', 0, 3]
            ]
        );
    });

    it('reports a single winner as untied', () => {
        const competition = newCompetition();
        competition.award('a');
        assert.equal(competition.leaderboard().tied, false);
    });
});
