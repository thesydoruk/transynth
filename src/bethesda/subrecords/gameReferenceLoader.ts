import fo3NpcRaw from '../../resources/game-reference/fo3-npc.json' with { type: 'json' };
import fo4NpcRaw from '../../resources/game-reference/fo4-npc.json' with { type: 'json' };
import fnvNpcRaw from '../../resources/game-reference/fnv-npc.json' with { type: 'json' };
import oblivionNpcRaw from '../../resources/game-reference/oblivion-npc.json' with { type: 'json' };
import skyrimNpcRaw from '../../resources/game-reference/skyrim-npc.json' with { type: 'json' };
import sseNpcRaw from '../../resources/game-reference/sse-npc.json' with { type: 'json' };
import type { GameType } from '../../types';

/**
 * A single entry in a game-reference JSON file.
 * The `term` field holds the human-readable name (NPC display name, race name, etc.).
 */
interface GameRefEntry {
  formId: string;
  term: string;
}

/** Pre-indexed NPC reference maps keyed by game identifier. */
const NPC_MAPS = new Map<GameType, Map<string, string>>();

/** Raw JSON data indexed by the game identifier they correspond to. */
const NPC_RAW = new Map<GameType, GameRefEntry[]>([
  ['fo3', fo3NpcRaw as GameRefEntry[]],
  ['fo4', fo4NpcRaw as GameRefEntry[]],
  ['fnv', fnvNpcRaw as GameRefEntry[]],
  ['ob', oblivionNpcRaw as GameRefEntry[]],
  ['sle', skyrimNpcRaw as GameRefEntry[]],
  ['sse', sseNpcRaw as GameRefEntry[]],
]);

/**
 * Return the NPC FormID → display-name reference map for a given game.
 *
 * The map is sourced from `src/resources/game-reference/{game}-npc.json`,
 * which contains vanilla game NPC records derived from the GameDico data set.
 * It is used as a fallback when an NPC's name cannot be resolved from the
 * mod's own NPC_ records (e.g. vanilla NPCs that are not re-declared in the mod).
 *
 * The map is built lazily on first access and cached for subsequent calls.
 *
 * Returns an empty Map for games that have no reference file.
 *
 * @param game - Target game identifier (e.g. `'fo4'`, `'sse'`, `'fo3'`).
 */
export const loadNpcReferenceMap = (game: GameType): Map<string, string> => {
  const cached = NPC_MAPS.get(game);
  if (cached) return cached;

  const raw = NPC_RAW.get(game);
  if (!raw) return new Map();

  const map = new Map(raw.map((e) => [e.formId.toUpperCase(), e.term]));
  NPC_MAPS.set(game, map);
  return map;
};
