/**
 * The nine games, in the order the plan lists them, and what kind each one is. Only games marked `implemented`
 * can appear in a playlist; the rest are here so the client can show the
 * full catalogue and so playlist code doesn't need a second list.
 */

export const GAME_IDS = [
    'minefield',
    'cube-counter',
    'crusher-escalator',
    'stop-the-clock',
    'type-racer-roulette',
    'liars-deck',
    'hidden-crossfire',
    'log-dodge',
    'word-bomb'
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
    'cube-counter': { id: 'cube-counter', title: 'Cube Counter', kind: 'self-timed', implemented: true },
    'crusher-escalator': { id: 'crusher-escalator', title: 'Crusher Escalator', kind: 'self-timed', implemented: true },
    'stop-the-clock': { id: 'stop-the-clock', title: 'Stop the Clock', kind: 'self-timed', implemented: true },
    'type-racer-roulette': { id: 'type-racer-roulette', title: 'Type Racer Roulette', kind: 'self-timed', implemented: true },
    'liars-deck': { id: 'liars-deck', title: "Liar's Deck", kind: 'turn-based', implemented: false },
    'hidden-crossfire': { id: 'hidden-crossfire', title: 'Hidden Crossfire', kind: 'shared-world', implemented: false },
    'log-dodge': { id: 'log-dodge', title: 'Log Dodge', kind: 'self-timed', implemented: true },
    'word-bomb': { id: 'word-bomb', title: 'Word Bomb', kind: 'turn-based', implemented: false }
};

export const isGameId = (value: unknown): value is GameId =>
    typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value);

export const implementedGameIds = (): GameId[] =>
    GAME_IDS.filter((id) => GAME_CATALOG[id].implemented);
