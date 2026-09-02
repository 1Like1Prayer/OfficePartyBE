/**
 * The ten games and what kind each one is. Only games marked `implemented`
 * can appear in a playlist; the rest are here so the client can show the
 * full catalogue and so playlist code doesn't need a second list.
 */

export const GAME_IDS = [
    'minefield',
    'chisel-gauntlet',
    'crusher-escalator',
    'safe-tile-arena',
    'pea-dinner',
    'train-alcoves',
    'blade-arena',
    'stop-the-clock',
    'type-racer-roulette',
    'liars-deck'
] as const;

export type GameId = (typeof GAME_IDS)[number];

/** How a game is synced. Determines which runner drives it. */
export type GameKind = 'self-timed' | 'shared-world' | 'turn-based';

export interface GameMeta {
    id: GameId;
    title: string;
    kind: GameKind;
    implemented: boolean;
}

export const GAME_CATALOG: Record<GameId, GameMeta> = {
    'minefield': { id: 'minefield', title: 'Minefield', kind: 'shared-world', implemented: false },
    'chisel-gauntlet': { id: 'chisel-gauntlet', title: 'Chisel Gauntlet', kind: 'self-timed', implemented: false },
    'crusher-escalator': { id: 'crusher-escalator', title: 'Crusher Escalator', kind: 'self-timed', implemented: false },
    'safe-tile-arena': { id: 'safe-tile-arena', title: 'Safe Tile Arena', kind: 'shared-world', implemented: false },
    'pea-dinner': { id: 'pea-dinner', title: 'Pea Dinner', kind: 'self-timed', implemented: false },
    'train-alcoves': { id: 'train-alcoves', title: 'Train Alcoves', kind: 'shared-world', implemented: false },
    'blade-arena': { id: 'blade-arena', title: 'Blade Arena', kind: 'shared-world', implemented: false },
    'stop-the-clock': { id: 'stop-the-clock', title: 'Stop the Clock', kind: 'self-timed', implemented: true },
    'type-racer-roulette': { id: 'type-racer-roulette', title: 'Type Racer Roulette', kind: 'self-timed', implemented: false },
    'liars-deck': { id: 'liars-deck', title: "Liar's Deck", kind: 'turn-based', implemented: false }
};

export const isGameId = (value: unknown): value is GameId =>
    typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);

export const implementedGameIds = (): GameId[] =>
    GAME_IDS.filter((id) => GAME_CATALOG[id].implemented);
