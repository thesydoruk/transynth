/**
 * The game plugin registry — the single answer to "which games exist?".
 *
 * This module imports no plugin, which is the point: everything in the
 * pipeline can look a game up here without forming an import cycle with the
 * plugin it is about to call.
 *
 * Filling the registry is `src/games/index.ts`'s job, and importing that module
 * is what performs the registration. Entry points — the API server, the worker,
 * each script, the Jest setup file — import it once at startup; a lookup before
 * that throws with a message saying so rather than silently returning nothing.
 */
import type { GameId } from '../types';
import type { GamePlugin } from './contract';

const PLUGINS = new Map<GameId, GamePlugin>();

/** Registration order, which is also the order games appear in the catalogue. */
const ORDER: GameId[] = [];

/**
 * Fallback used when a game id is missing or unknown.
 *
 * Mods imported before the column existed have `mods.game IS NULL`, and old
 * links still carry ids that were never valid; both must land somewhere rather
 * than crash. Fallout 4 is the app's original and most complete title.
 */
export const DEFAULT_GAME_ID: GameId = 'fo4';

/** Register one game. Called by `src/games/index.ts`; throws on a duplicate id. */
export const registerGamePlugin = (plugin: GamePlugin): void => {
  if (PLUGINS.has(plugin.id)) {
    throw new Error(`Duplicate game plugin id "${plugin.id}"`);
  }
  PLUGINS.set(plugin.id, plugin);
  ORDER.push(plugin.id);
};

/** Is this string the id of a registered game? */
export const isGameId = (value: string | null | undefined): value is GameId =>
  value != null && PLUGINS.has(value);

/**
 * Narrow an id that came from outside — a DB column, a query string, an upload
 * form — to a registered one, falling back to {@link DEFAULT_GAME_ID}.
 * Matching is case-insensitive because `mods.game` is free-form text.
 */
export const resolveGameId = (value: string | null | undefined): GameId => {
  const id = value?.trim().toLowerCase();
  return id && PLUGINS.has(id) ? id : DEFAULT_GAME_ID;
};

/** The plugin for a registered id. Unknown ids fall back to {@link DEFAULT_GAME_ID}. */
export const gamePlugin = (game: GameId | string | null | undefined): GamePlugin => {
  const plugin = PLUGINS.get(resolveGameId(game));
  if (!plugin) {
    throw new Error(
      `No game plugin registered for "${DEFAULT_GAME_ID}" — import "src/games" before using the registry`,
    );
  }
  return plugin;
};

/** The plugin for an id, or null when the id is not registered. */
export const findGamePlugin = (game: string | null | undefined): GamePlugin | null =>
  (game != null && PLUGINS.get(game.trim().toLowerCase())) || null;

/** Every registered plugin, in registration order. */
export const allGamePlugins = (): readonly GamePlugin[] => ORDER.map((id) => PLUGINS.get(id)!);

/** Every registered game id, in registration order. */
export const allGameIds = (): readonly GameId[] => [...ORDER];
