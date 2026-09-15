/**
 * Vanilla NPC reference data.
 *
 * Pre-extracted FormID → display-name maps (GameDico exports) used during
 * import to name speakers a mod references but does not redeclare. Each title
 * points at its own file; a title with no export gets an empty map.
 */
import fo3Npc from './game-reference/fo3-npc.json' with { type: 'json' };
import fo4Npc from './game-reference/fo4-npc.json' with { type: 'json' };
import fnvNpc from './game-reference/fnv-npc.json' with { type: 'json' };
import oblivionNpc from './game-reference/oblivion-npc.json' with { type: 'json' };
import skyrimNpc from './game-reference/skyrim-npc.json' with { type: 'json' };
import sseNpc from './game-reference/sse-npc.json' with { type: 'json' };

/** One row of a game-reference file; `term` is the human-readable name. */
type GameRefEntry = { formId: string; term: string };

/** Build a lazy, memoized FormID → name lookup from a reference export. */
const npcMap = (raw: GameRefEntry[] | null): (() => Map<string, string>) => {
  let cached: Map<string, string> | null = null;
  return () => {
    cached ??= new Map((raw ?? []).map((entry) => [entry.formId.toUpperCase(), entry.term]));
    return cached;
  };
};

export const fo3NpcReference = npcMap(fo3Npc as GameRefEntry[]);
export const fo4NpcReference = npcMap(fo4Npc as GameRefEntry[]);
export const fnvNpcReference = npcMap(fnvNpc as GameRefEntry[]);
export const oblivionNpcReference = npcMap(oblivionNpc as GameRefEntry[]);
export const skyrimNpcReference = npcMap(skyrimNpc as GameRefEntry[]);
export const sseNpcReference = npcMap(sseNpc as GameRefEntry[]);

/** Titles with no vanilla NPC export (Morrowind, Fallout 76). */
export const noNpcReference = npcMap(null);
