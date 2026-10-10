/**
 * What the game name in an EET header says about where the file belongs.
 *
 * ESP-ESM Translator writes a free-form title ("Fallout 4", "Skyrim") into the
 * header. It is read against the registered plugins' own names and ids rather
 * than a list of known spellings, so a new game needs nothing here.
 */
import { allGamePlugins, gamePlugin } from '../../games/registry';
import type { GameId } from '../../types';

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Registered games an EET header's game name could mean: a plugin whose id,
 * title, Nexus domain or Vortex id equals the name or starts with it — so
 * "Skyrim" means both Skyrim editions, and an empty or unknown name means none.
 */
export const gamesNamedByEet = (gameName: string): GameId[] => {
  const name = normalize(gameName);
  if (!name) return [];
  return allGamePlugins()
    .filter((plugin) =>
      [
        plugin.id,
        plugin.catalogue.name,
        plugin.catalogue.nexus?.domain,
        plugin.deployment?.vortexId,
      ].some((key) => key != null && normalize(key).startsWith(name)),
    )
    .map((plugin) => plugin.id);
};

/**
 * True when the header names a game and that game cannot be `game`.
 *
 * Editions that share stored text (one glossary key, like Skyrim SE and LE)
 * count as the same game. A name no plugin claims proves nothing, so it is
 * never a mismatch.
 */
export const eetNamesOtherGame = (gameName: string, game: GameId): boolean => {
  const named = gamesNamedByEet(gameName);
  const glossary = gamePlugin(game).storageKeys.glossary;
  return named.length > 0 && !named.some((id) => gamePlugin(id).storageKeys.glossary === glossary);
};
