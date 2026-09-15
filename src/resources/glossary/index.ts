/**
 * Canonical EN→UK terminology per game.
 *
 * The lists themselves live with the games that own them; this is only the
 * lookup the prompt builder and the glossary seeder go through.
 */
import { allGamePlugins } from '../../games/registry';
import type { GameId } from '../../types';
import type { GlossaryEntry } from './types';

export type { GlossaryEntry } from './types';

/**
 * Every game's terminology, keyed by the game whose rows it is stored under —
 * so editions that share a list (Skyrim LE and SE) appear once.
 */
export const gameUkGlossaries = (): Map<GameId, GlossaryEntry[]> => {
  const byStorageKey = new Map<GameId, GlossaryEntry[]>();
  for (const plugin of allGamePlugins()) {
    byStorageKey.set(plugin.storageKeys.glossary, plugin.prompts.glossary);
  }
  return byStorageKey;
};
