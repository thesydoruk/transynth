import { CONFIG } from '../config';
import type { Tx } from '../db';
import type { GameType } from '../types';

export type ImportedMod = {
  modId: number;
  modName: string;
  srcLang: string;
  game: GameType;
  isLocalized: boolean;
};

/** Load metadata for an uploaded mod that has a completed import. */
export const loadImportedMod = async (db: Tx, modId: number): Promise<ImportedMod> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    src_lang: string | null;
    game: string | null;
    is_localized: number | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        mi.src_lang,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.is_localized
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id AND mi.status = 'completed'
     WHERE m.id = $1
     ORDER BY m.id, mi.updated_at DESC`,
    [modId],
  );
  const row = rows[0];
  if (!row) throw new Error(`Mod id=${modId} not found or has no completed import`);
  return {
    modId: row.mod_id,
    modName: row.mod_name,
    srcLang: row.src_lang?.trim() || CONFIG.defaultSrcLang,
    game: (row.game ?? 'fo4') as GameType,
    isLocalized: (row.is_localized ?? 0) === 1,
  };
};
