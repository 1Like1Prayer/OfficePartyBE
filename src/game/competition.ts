/**
 * The competition layer (section 6).
 *
 * Lobby -> for each game: [round 1 -> results -> round 2 -> results] ->
 * final leaderboard -> Lobby.
 *
 * It owns the playlist, the position within it, and the score table. Games
 * report a winner and never touch the leaderboard themselves.
 */

import { COMPETITION } from '../shared/constants';
import { GAME_CATALOG, type GameId } from '../shared/games/catalog';
import type {
    LeaderboardPayload,
    LeaderboardRow,
    PlaylistMode,
    PlaylistPayload,
    ScoreRow
} from '../shared/protocol';
import { isPlayable, playableGameIds } from './registry';

export interface PlaylistError {
    code: 'invalid_playlist';
    message: string;
}

/** Fisher-Yates, on a copy, with an injectable RNG so tests can pin it. */
const shuffled = <T>(items: readonly T[], rng: () => number): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
};

/**
 * Random mode picks up to five distinct games. It can only pick from games
 * that are actually built, so today that is a shorter list than five.
 */
export const buildRandomPlaylist = (rng: () => number = Math.random): GameId[] => {
    const pool = playableGameIds();
    return shuffled(pool, rng).slice(0, COMPETITION.RANDOM_PLAYLIST_SIZE);
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
    /** 1-based round within the game (1 or 2). */
    roundInGame: number;
}

export class Competition {
    readonly mode: PlaylistMode;
    readonly playlist: readonly GameId[];

    private gameCursor = 0;
    private roundCursor = 0;
    private roundIdCounter = 0;
    private readonly scores = new Map<string, number>();

    constructor(mode: PlaylistMode, playlist: readonly GameId[], players: readonly string[]) {
        this.mode = mode;
        this.playlist = playlist;
        for (const playerId of players) this.scores.set(playerId, 0);
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
            roundInGame: this.roundCursor + 1
        };
    }

    /** Claim the next roundId. Called once per scoring round. */
    nextRoundId(): number {
        return ++this.roundIdCounter;
    }

    /** Move past the round just finished. Returns false when the match is over. */
    advance(): boolean {
        this.roundCursor += 1;
        if (this.roundCursor >= COMPETITION.ROUNDS_PER_GAME) {
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
        return {
            mode: this.mode,
            playlist: [...this.playlist],
            roundsPerGame: COMPETITION.ROUNDS_PER_GAME,
            totalRounds: this.playlist.length * COMPETITION.ROUNDS_PER_GAME
        };
    }
}
