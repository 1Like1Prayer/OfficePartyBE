import test from 'node:test';
import assert from 'node:assert/strict';
import { Competition } from './competition';

const newCompetition = (playlist: ('stop-the-clock' | 'cube-counter')[]) =>
    new Competition({ mode: 'custom', playlist, players: ['a', 'b'] });

/** Plays the whole competition out and returns each round's position. */
const walk = (competition: Competition): string[] => {
    const visited: string[] = [];
    for (let position = competition.position(); position; position = competition.position()) {
        visited.push(`${position.gameId}:${position.roundInGame}/${position.roundsPerGame}`);
        competition.advance();
    }
    return visited;
};

test('each game is played for its own number of rounds', () => {
    assert.deepEqual(walk(newCompetition(['stop-the-clock', 'cube-counter'])), [
        'stop-the-clock:1/4',
        'stop-the-clock:2/4',
        'stop-the-clock:3/4',
        'stop-the-clock:4/4',
        'cube-counter:1/2',
        'cube-counter:2/2'
    ]);
});

test('playlist description reports rounds per game and the total', () => {
    const description = newCompetition(['cube-counter', 'stop-the-clock']).describePlaylist();
    assert.deepEqual(description.roundsByGame, { 'cube-counter': 2, 'stop-the-clock': 4 });
    assert.equal(description.totalRounds, 6);
});

test('one point per scoring round, so Stop the Clock offers 4 and Cube Counter 2', () => {
    const competition = newCompetition(['stop-the-clock', 'cube-counter']);
    for (let position = competition.position(); position; position = competition.position()) {
        competition.award('a');
        competition.advance();
    }
    assert.equal(competition.scoreRows()[0]?.points, 6);
});
