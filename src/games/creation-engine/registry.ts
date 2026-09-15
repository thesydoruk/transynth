/**
 * Lookup for Creation Engine titles.
 *
 * The Bethesda pipeline modules (`src/import`, `src/web/export`, `src/voice`,
 * `src/modImport`) are shared by all eight titles. Rather than thread a title
 * descriptor through every signature, they keep taking a `GameId` and resolve
 * it here — the same shape as `gamePlugin(id)`, one level down.
 *
 * Asking for a title that is not Creation Engine is a programming error: the
 * caller reached Bethesda-only code with, say, a Disco Elysium mod.
 */
import type { GameId } from '../../types';
import type { CreationEngineTitle } from './title';

const TITLES = new Map<GameId, CreationEngineTitle>();

/** Called by `createCreationEnginePlugin` as each title's plugin is built. */
export const registerCreationEngineTitle = (title: CreationEngineTitle): void => {
  TITLES.set(title.id, title);
};

/** The title descriptor for a Creation Engine game id. Throws for anything else. */
export const creationEngineTitle = (
  game: GameId | string | null | undefined,
): CreationEngineTitle => {
  const title = game != null ? TITLES.get(game.trim().toLowerCase()) : undefined;
  if (!title) {
    throw new Error(
      `"${game ?? 'null'}" is not a Creation Engine title — this code path is Bethesda-only`,
    );
  }
  return title;
};
