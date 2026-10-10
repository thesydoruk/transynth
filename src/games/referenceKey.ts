/**
 * Which game's reference translations a title reads and writes.
 *
 * Editions that ship the same text (Skyrim LE and SE) share one reference
 * base, exactly as they share one glossary, so the glossary storage key is
 * reused rather than adding a second key to every plugin.
 */
import type { GameId } from '../types';
import { allGamePlugins, gamePlugin } from './registry';

export const referenceGameKey = (game?: GameId | string | null): GameId =>
  gamePlugin(game).storageKeys.glossary;

/**
 * SQL expression folding a mod's game id column into its reference storage
 * key, mirroring {@link referenceGameKey} for rows selected in bulk. Ids come
 * from registered plugins, never from user input, and are restricted to
 * url-safe characters before they reach the SQL.
 */
export const referenceGameSql = (column: string): string => {
  const branches = allGamePlugins()
    .filter((plugin) => plugin.storageKeys.glossary !== plugin.id)
    .filter((plugin) => /^[a-z0-9_-]+$/.test(plugin.id + plugin.storageKeys.glossary))
    .map((plugin) => `WHEN ${column} = '${plugin.id}' THEN '${plugin.storageKeys.glossary}'`);
  return branches.length > 0 ? `CASE ${branches.join(' ')} ELSE ${column} END` : column;
};
