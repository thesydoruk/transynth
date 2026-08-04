import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import type { EspPatch } from '../../formats/types';
import { patchEsp, parseSubrecordPath } from '../../formats/esp';
import { log } from '../../logger';
import type { ExportedStringsFile } from './exportTypes';

type EspPatchRow = {
  formid_hex: string;
  path: string;
  source_text: string;
  occurrence: number;
  text: string;
};

/**
 * Collect inline-text patches for a non-localized plugin.
 *
 * A record path keeps only the subrecord signature, so records that repeat one
 * signature (TERM menu items, QUST objectives, INFO responses) yield several rows
 * sharing `(formid_hex, path)`. Each row therefore carries its position within the
 * record — numbered over *all* source strings, not just translated ones, so that
 * partially translated records keep their occurrences aligned.
 */
const getEspPatches = async (
  db: Tx,
  modId: number,
  srcLang: string,
  targetLang: string,
): Promise<EspPatch[]> => {
  const { rows } = await db.query(
    `WITH src AS (
       SELECT s.id AS string_id, r.formid_hex, r.path, s.text_raw,
              (ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id) - 1)::int AS occurrence
       FROM strings s
       JOIN records r ON r.id = s.record_id
       WHERE r.mod_id = $1 AND s.lang = $2 AND s.lstring_id IS NULL
     )
     SELECT src.formid_hex, src.path, src.text_raw AS source_text, src.occurrence, t.text
     FROM src
     JOIN translations t
       ON t.src_string_id = src.string_id AND t.target_lang = $3
     ORDER BY src.formid_hex, src.path, src.occurrence`,
    [modId, srcLang, targetLang],
  );

  const patches: EspPatch[] = [];
  for (const row of rows as EspPatchRow[]) {
    if (!row.formid_hex || !row.text) continue;
    const ref = parseSubrecordPath(row.path);
    if (!ref) continue;
    patches.push({
      formId: row.formid_hex,
      subrecord: ref.subrecord,
      oldText: row.source_text ?? '',
      occurrence: ref.index ?? row.occurrence,
      newText: row.text,
    });
  }
  return patches;
};

export const exportPatchedEsp = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
): Promise<ExportedStringsFile> => {
  if (!fs.existsSync(modPath)) {
    throw new Error(`Original ESP file not found: ${modPath}`);
  }

  const patches = await getEspPatches(db, modId, srcLang, targetLang);
  if (patches.length === 0) {
    throw new Error(`No translations found for non-localized export (mod ${modId})`);
  }

  log.info(`ESP export: ${patches.length} patches for mod ${modId}`);
  const originalBuf = fs.readFileSync(modPath);
  const patchedBuf = patchEsp(originalBuf, patches);
  const fileName = path.basename(modPath);

  return {
    fileName,
    size: patchedBuf.length,
    contentBase64: patchedBuf.toString('base64'),
  };
};
