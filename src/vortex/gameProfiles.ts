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

/**
 * Creation Club plugins ship with the game and are updated by it, so they are
 * never treated as mod content — the `cc` prefix is the store's convention.
 */
const isCreationClubPlugin = (fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  return (
    lower.startsWith('cc') &&
    (lower.endsWith('.esm') || lower.endsWith('.esl') || lower.endsWith('.esp'))
  );
};

export const isOfficialGamePlugin = (game: GameId, fileName: string): boolean => {
  const lower = fileName.toLowerCase();
  if (officialMasterNames(game).some((name) => name.toLowerCase() === lower)) return true;
  return isCreationClubPlugin(fileName);
};
