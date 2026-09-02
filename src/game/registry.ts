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
import { stopTheClockModule } from '../shared/games/stopTheClock';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySelfTimedModule = SelfTimedGameModule<any, any>;

const SELF_TIMED_MODULES: Partial<Record<GameId, AnySelfTimedModule>> = {
    'stop-the-clock': stopTheClockModule
};

export const getSelfTimedModule = (
    gameId: GameId
): AnySelfTimedModule | null => SELF_TIMED_MODULES[gameId] ?? null;

/** Games a playlist may actually contain right now. */
export const playableGameIds = (): GameId[] =>
    (Object.keys(SELF_TIMED_MODULES) as GameId[]).filter(
        (id) => GAME_CATALOG[id].implemented
    );

export const isPlayable = (gameId: GameId): boolean =>
    getSelfTimedModule(gameId) !== null && GAME_CATALOG[gameId].implemented;
