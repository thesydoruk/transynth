import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { GameType } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Path to the bundled game-reference data directory. */
const REF_DIR = path.resolve(__dirname, '../resources/game-reference');

/**
 * A single entry in a game-reference JSON file.
 * The `term` field holds the human-readable name (NPC display name, race name, etc.).
 */
interface GameRefEntry {
  formId: string;
  term: string;
}

/**
 * Load the NPC FormID → display-name reference map for a given game.
 *
 * The map is sourced from `src/resources/game-reference/{game}-npc.json`,
 * which contains vanilla game NPC records derived from the GameDico data set.
 * It is used as a fallback when an NPC's name cannot be resolved from the
 * mod's own NPC_ records (e.g. vanilla NPCs that are not re-declared in the mod).
 *
 * Returns an empty Map if no reference file exists for the requested game.
 *
 * @param game - Target game identifier (e.g. `'fo4'`, `'sse'`, `'fo3'`).
 */
export const loadNpcReferenceMap = (game: GameType): Map<string, string> => {
  const filePath = path.join(REF_DIR, `${game}-npc.json`);
  if (!fs.existsSync(filePath)) return new Map();

  const entries: GameRefEntry[] = JSON.parse(fs.readFileSync(filePath, 'utf8')) as GameRefEntry[];
  return new Map(entries.map((e) => [e.formId.toUpperCase(), e.term]));
};
