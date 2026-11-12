/**
 * The game registry. A room asks it for the module behind a GameId and gets
 * back something the appropriate runner can drive.
 *
 * Only self-timed games exist so far. When the movement layer lands, this is
 * where shared-world modules get registered alongside them and the room picks
 * a runner by `kind`.
 */

import { GAME_CATALOG, type GameId } from '../shared/games/catalog';
import type { SelfTimedGameModule } from '../shared/games/selfTimed';
import { crusherEscalatorModule } from '../shared/games/crusherEscalator/module';
import { cubeCounterModule } from '../shared/games/cubeCounter/module';
import { minefieldModule } from '../shared/games/minefield/module';
import { logDodgeModule } from '../shared/games/logDodge/module';
import { createTypeRacerModule } from '../shared/games/typeRacer/module';
import { stopTheClockModule } from '../shared/games/stopTheClock';
import { hmacRollFace } from './diceRolls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySelfTimedModule = SelfTimedGameModule<any, any>;

const SELF_TIMED_MODULES: Partial<Record<GameId, AnySelfTimedModule>> = {
    'crusher-escalator': crusherEscalatorModule,
    'cube-counter': cubeCounterModule,
    'log-dodge': logDodgeModule,
    'minefield': minefieldModule,
    'stop-the-clock': stopTheClockModule,
    'type-racer-roulette': createTypeRacerModule(hmacRollFace)
};

export const getSelfTimedModule = (
    gameId: GameId
): AnySelfTimedModule | null => SELF_TIMED_MODULES[gameId] ?? null;

/** How many scoring rounds a game is played for. Zero for games that aren't built. */
export const roundsForGame = (gameId: GameId): number =>
    getSelfTimedModule(gameId)?.roundsPerGame ?? 0;

/** Games a playlist may actually contain right now. */
export const playableGameIds = (): GameId[] =>
    (Object.keys(SELF_TIMED_MODULES) as GameId[]).filter(
        (id) => GAME_CATALOG[id].implemented
    );

export const isPlayable = (gameId: GameId): boolean =>
    getSelfTimedModule(gameId) !== null && GAME_CATALOG[gameId].implemented;
