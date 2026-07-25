import type { StringsType } from '../../formats/types/StringsType';
import type { GameType } from '../../types';
import type { Tx } from '../../db';
import { resolveStringsTableType, subrecordFieldFromPath } from '../../formats/strings/recorddefs';

const emptyOverlays = (): Map<StringsType, Map<number, string>> =>
  new Map([
    ['STRINGS', new Map()],
    ['DLSTRINGS', new Map()],
    ['ILSTRINGS', new Map()],
  ]);

/**
 * Build per-table overlay maps of `lstring_id → export_text` for a mod.
 *
 * Each Bethesda strings file (STRINGS / DLSTRINGS / ILSTRINGS) has its own id
 * namespace; routing follows xTranslator `_recorddefs.txt` per game.
 */
export const getTranslationOverlaysByType = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<Map<StringsType, Map<number, string>>> => {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (s.lstring_id, r.signature, r.path)
        s.lstring_id,
        r.signature,
        r.path,
        COALESCE(t.text, s.text_raw) AS export_text
     FROM strings s
     JOIN records r ON r.id = s.record_id
     LEFT JOIN translations t
       ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.lstring_id IS NOT NULL
     ORDER BY s.lstring_id, r.signature, r.path, s.created_at DESC`,
    [modId, srcLang, targetLang],
  );

  const overlays = emptyOverlays();
  for (const row of rows as Array<{
    lstring_id: number;
    signature: string;
    path: string;
    export_text: string;
  }>) {
    const field = subrecordFieldFromPath(row.path);
    if (!row.signature || !field) continue;
    const table = resolveStringsTableType(game, row.signature, field);
    overlays.get(table)!.set(row.lstring_id, row.export_text);
  }
  return overlays;
};

/**
 * @deprecated Use {@link getTranslationOverlaysByType} and select the target table.
 */
export const getTranslationOverlay = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<Map<number, string>> => {
  const overlays = await getTranslationOverlaysByType(db, modId, srcLang, targetLang, game);
  const merged = new Map<number, string>();
  for (const map of overlays.values()) {
    for (const [id, text] of map) merged.set(id, text);
  }
  return merged;
};

export const hasTranslationOverlayChanges = (
  sourceMap: Map<number, string>,
  overlay: Map<number, string>,
): boolean => {
  for (const [id, srcText] of sourceMap) {
    const exportText = overlay.get(id);
    if (exportText !== undefined && exportText !== srcText) return true;
  }
  return false;
};
