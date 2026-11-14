/**
 * Deployment facts the Vortex integration needs, read from the game plugin.
 *
 * Only a game whose plugin declares a deployment adapter can be scanned or
 * have a load order written; everything else answers "nothing to deploy".
 */
import { gamePlugin } from '../games/registry';
import type { GameId } from '../types';

/** Base-game and DLC plugins that ship with the game, not with a mod. */
export const officialMasterNames = (game: GameId): readonly string[] =>
  gamePlugin(game).deployment?.officialMasters ?? [];

/** Folder under `%LOCALAPPDATA%` holding the game's plugin / load-order files. */
export const gameLocalAppFolder = (game: GameId): string | undefined =>
  gamePlugin(game).deployment?.localAppFolder;

/** Vortex's internal game id, used for `%APPDATA%/Vortex/<id>/profiles`. */
export const vortexGameId = (game: GameId): string | undefined =>
  gamePlugin(game).deployment?.vortexId;

/** Executable used to locate the install root during a scan. */
export const exeNameForGame = (game: GameId): string | undefined =>
  gamePlugin(game).deployment?.exeName;

/** Whether a file ships with the game (base, DLC, add-on) rather than with a mod. */
export const isOfficialGamePlugin = (game: GameId, fileName: string): boolean =>
  (gamePlugin(game).content?.classify(fileName) ?? 'mod') !== 'mod';
