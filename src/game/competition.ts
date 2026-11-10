/**
 * The competition layer (section 6).
 *
 * Lobby -> for each game: [each of its rounds -> results] -> final
 * leaderboard -> Lobby. Every game declares how many rounds it gets.
 *
 * It owns the playlist, the position within it, and the score table. Games
 * report a winner and never touch the leaderboard themselves.
 */

import { COMPETITION } from '../shared/constants';
import { GAME_CATALOG, type GameId } from '../shared/games/catalog';
import { shuffled } from '../shared/games/random';
import type {
    LeaderboardPayload,
    LeaderboardRow,
    PlaylistMode,
    PlaylistPayload,
    RoundsByGame,
    ScoreRow
} from '../shared/protocol';
import { isPlayable, playableGameIds, roundsForGame } from './registry';

export interface PlaylistError {
    code: 'invalid_playlist';
    message: string;
}

/**
 * Random mode picks up to five distinct games. It can only pick from games
 * that are actually built, so today that is a shorter list than five.
 */
export const buildRandomPlaylist = (): GameId[] => {
    const pool = playableGameIds();
    return shuffled(pool).slice(0, COMPETITION.RANDOM_PLAYLIST_SIZE);
};

/** Custom mode keeps the owner's order and rejects anything unplayable. */
export const buildCustomPlaylist = (
    requested: readonly GameId[]
): GameId[] | PlaylistError => {
    if (requested.length < 1 || requested.length > COMPETITION.MAX_CUSTOM_PLAYLIST_SIZE) {
        return {
            code: 'invalid_playlist',
            message: `Pick between 1 and ${COMPETITION.MAX_CUSTOM_PLAYLIST_SIZE} games.`
        };
    }
    const seen = new Set<GameId>();
    for (const gameId of requested) {
        if (!isPlayable(gameId)) {
            return {
                code: 'invalid_playlist',
                message: `${GAME_CATALOG[gameId]?.title ?? gameId} isn't playable yet.`
            };
        }
        if (seen.has(gameId)) {
            return { code: 'invalid_playlist', message: 'Games must be distinct.' };
        }
        seen.add(gameId);
    }
    return [...requested];
};

export interface RoundPosition {
    gameId: GameId;
    /** 1-based position in the playlist. */
    gameIndex: number;
    totalGames: number;
    /** 1-based round within the game. */
    roundInGame: number;
    /** How many scoring rounds this game has in total. */
    roundsPerGame: number;
}

export class Competition {
    readonly mode: PlaylistMode;
    readonly playlist: readonly GameId[];

    private gameCursor = 0;
    private roundCursor = 0;
    private roundIdCounter = 0;
    private readonly scores = new Map<string, number>();

    constructor(params: {
        mode: PlaylistMode;
        playlist: readonly GameId[];
        players: readonly string[];
    }) {
        this.mode = params.mode;
        this.playlist = params.playlist;
        for (const playerId of params.players) this.scores.set(playerId, 0);
    }

    /** Players who join mid-competition watch, but exist on the score table at 0. */
    ensurePlayer(playerId: string): void {
        if (!this.scores.has(playerId)) this.scores.set(playerId, 0);
    }

    get finished(): boolean {
        return this.gameCursor >= this.playlist.length;
    }

    get roundId(): number {
        return this.roundIdCounter;
    }

    /** Where we are now, or null once the playlist is exhausted. */
    position(): RoundPosition | null {
        const gameId = this.playlist[this.gameCursor];
        if (gameId === undefined) return null;
        return {
            gameId,
            gameIndex: this.gameCursor + 1,
            totalGames: this.playlist.length,
            roundInGame: this.roundCursor + 1,
            roundsPerGame: roundsForGame(gameId)
        };
    }

    /** Claim the next roundId. Called once per scoring round. */
    nextRoundId(): number {
        return ++this.roundIdCounter;
    }

    /** Move past the round just finished. Returns false when the match is over. */
    advance(): boolean {
        this.roundCursor += 1;
        const currentGame = this.playlist[this.gameCursor];
        if (currentGame === undefined || this.roundCursor >= roundsForGame(currentGame)) {
            this.roundCursor = 0;
            this.gameCursor += 1;
        }
        return !this.finished;
    }

    /** One point per scoring round. A round with no winner awards nothing. */
    award(winnerId: string | null): void {
        if (winnerId === null) return;
        this.scores.set(winnerId, (this.scores.get(winnerId) ?? 0) + 1);
    }

    scoreRows(): ScoreRow[] {
        return [...this.scores]
            .map(([playerId, points]) => ({ playerId, points }))
            .sort((a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId));
    }

    /** Tied final scores are left tied — there is no overall tiebreaker. */
    leaderboard(): LeaderboardPayload {
        const rows: LeaderboardRow[] = [];
        let lastPoints: number | null = null;
        let lastRank = 0;

        this.scoreRows().forEach((row, index) => {
            const rank = lastPoints === row.points ? lastRank : index + 1;
            lastPoints = row.points;
            lastRank = rank;
            rows.push({ ...row, rank });
        });

        const winners = rows.filter((row) => row.rank === 1);
        return { rows, tied: winners.length > 1 };
    }

    describePlaylist(): PlaylistPayload {
        const roundsByGame: RoundsByGame = {};
        for (const gameId of this.playlist) roundsByGame[gameId] = roundsForGame(gameId);

        return {
            mode: this.mode,
            playlist: [...this.playlist],
            roundsByGame,
            totalRounds: this.playlist.reduce((sum, id) => sum + roundsForGame(id), 0)
        };
    }
}
