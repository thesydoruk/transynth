/**
 * Bulk database writes for mod import (records, strings, translations).
 */
import type { CsvRow } from '../types';
import type { Tx } from '../db';
import { sha1Hex } from '../utils/hash';
import { normalizeForHash, normalizeNoPunct } from '../utils/textNorm';

export type ModImportBulkRow = {
  csvRow: CsvRow;
  locale: string;
  context: string | null;
  sourceKind?: string;
};

export type ModImportBulkResult = {
  recordId: number;
  stringId: number;
  row: ModImportBulkRow;
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** Upsert records and insert strings for one import batch. */
export const bulkInsertModImportRows = async (
  db: Tx,
  modId: number,
  rows: ModImportBulkRow[],
): Promise<ModImportBulkResult[]> => {
  if (rows.length === 0) return [];

  const modIds: number[] = [];
  const signatures: string[] = [];
  const paths: string[] = [];
  const pathSimplified: string[] = [];
  const edids: (string | null)[] = [];
  const hashNorms: string[] = [];
  const formIds: string[] = [];
  const langs: string[] = [];
  const textRaws: string[] = [];
  const textNorms: string[] = [];
  const textNormNopunct: (string | null)[] = [];
  const sourceKinds: string[] = [];
  const contexts: (string | null)[] = [];

  for (const item of rows) {
    const r = item.csvRow;
    const pathS = r.PathSimplified ?? r.Path.replace(/\[\d+\]/g, '');
    const textNorm = normalizeForHash(r.Source);
    modIds.push(modId);
    signatures.push(r.Signature);
    paths.push(r.Path);
    pathSimplified.push(pathS);
    edids.push(r.EDID ?? null);
    hashNorms.push(sha1Hex(textNorm));
    formIds.push(r.FormID || '');
    langs.push(item.locale);
    textRaws.push(r.Source);
    textNorms.push(textNorm);
    textNormNopunct.push(normalizeNoPunct(r.Source));
    sourceKinds.push(item.sourceKind ?? 'mod-import');
    contexts.push(item.context);
  }

  await db.query(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     SELECT * FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]
     )
     ON CONFLICT(mod_id, signature, path, formid_hex) DO UPDATE SET
       path_simplified = EXCLUDED.path_simplified,
       edid = COALESCE(EXCLUDED.edid, records.edid),
       hash_norm = EXCLUDED.hash_norm`,
    [modIds, signatures, paths, pathSimplified, edids, hashNorms, formIds],
  );

  const { rows: recordRows } = await db.query<{ id: number; ord: number }>(
    `SELECT r.id, i.ord::int AS ord
     FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[]
     ) WITH ORDINALITY AS i(mod_id, signature, path, formid_hex, ord)
     JOIN records r
       ON r.mod_id = i.mod_id
      AND r.signature = i.signature
      AND r.path = i.path
      AND r.formid_hex = i.formid_hex
     ORDER BY i.ord`,
    [modIds, signatures, paths, formIds],
  );

  const recordIds = recordRows.map((r) => r.id);

  const { rows: stringRows } = await db.query<{ id: number }>(
    `INSERT INTO strings(
       record_id, lang, lstring_id, text_raw, text_norm, source_kind, text_norm_nopunct, context
     )
     SELECT i.record_id, i.lang, NULL, i.text_raw, i.text_norm, i.source_kind, i.text_norm_nopunct, i.context
     FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]
     ) AS i(record_id, lang, text_raw, text_norm, source_kind, text_norm_nopunct, context)
     RETURNING id`,
    [recordIds, langs, textRaws, textNorms, sourceKinds, textNormNopunct, contexts],
  );

  return rows.map((row, index) => ({
    recordId: recordIds[index]!,
    stringId: stringRows[index]!.id,
    row,
  }));
};

export type BulkTranslationRow = {
  srcStringId: number;
  text: string;
};

/** Fast translation upsert for import pipelines (no RAG, revision, or QA). */
export const bulkUpsertImportTranslations = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  provenance: string,
  batchSize = 1000,
): Promise<number> => {
  let total = 0;
  for (const part of chunk(items, batchSize)) {
    if (part.length === 0) continue;
    const stringIds = part.map((p) => p.srcStringId);
    const texts = part.map((p) => p.text);
    await db.query(
      `DELETE FROM translations WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
      [stringIds, targetLang],
    );
    await db.query(
      `INSERT INTO translations(
         src_string_id, target_lang, text, status, confidence, provenance, user_id, updated_at
       )
       SELECT s, $3, t, 'reviewed', 1.0, $4, NULL, NOW()
       FROM UNNEST($1::int[], $2::text[]) AS u(s, t)`,
      [stringIds, texts, targetLang, provenance],
    );
    total += part.length;
  }
  return total;
};
