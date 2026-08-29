import type { Tx } from '../../../db';

export type ImportedLocaleRow = {
  formid_hex: string;
  path: string;
  path_simplified: string | null;
  signature: string | null;
  edid: string | null;
  text_raw: string;
};

/**
 * Load locale text for apply-imported.
 * Prefers `strings.lang`, then falls back to `translations.target_lang`
 * (localized imports convert non-source locales to translations and delete those strings).
 */
export const loadImportedModLocaleRows = async (
  db: Tx,
  fromModId: number,
  importedLang: string,
): Promise<ImportedLocaleRow[]> => {
  const { rows: stringRows } = await db.query<ImportedLocaleRow>(
    `SELECT r.formid_hex,
            r.path,
            r.path_simplified,
            r.signature,
            r.edid,
            s.text_raw
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2`,
    [fromModId, importedLang],
  );
  if (stringRows.length > 0) return stringRows;

  const { rows: translationRows } = await db.query<ImportedLocaleRow>(
    `SELECT r.formid_hex,
            r.path,
            r.path_simplified,
            r.signature,
            r.edid,
            t.text AS text_raw
     FROM translations t
     JOIN strings s ON t.src_string_id = s.id
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND t.target_lang = $2`,
    [fromModId, importedLang],
  );
  return translationRows;
};
