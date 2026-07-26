/**
 * Bulk PostgreSQL ingest for tabular record imports (EET, CSV).
 *
 * Replaces per-row upsertRecord / insertString / addTranslation round-trips
 * with UNNEST batch queries (same pattern as the mod bulk writers here).
 */
import type { Tx } from '../../db';
import { sha1Hex } from '../../utils/hash';
import { normalizeForHash, normalizeNoPunct } from '../../utils/textNorm';
import { modImportRecordKey } from './recordKeys';

/** Minimal row shape shared by EET and CSV import pipelines. */
export type RecordImportRow = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
};

export type RecordImportBulkResult = {
  recordId: number;
  stringId: number;
  record: RecordImportRow;
};

export type RecordImportBulkOptions = {
  sourceKind: string;
  provenance: string;
};

export const recordTranslationMeta = (
  statusByte: number,
): { status: string; confidence: number } => ({
  status: statusByte === 0x63 ? 'human' : 'auto',
  confidence: statusByte === 0x63 ? 1.0 : 0.5,
});

/** @deprecated Use {@link recordTranslationMeta}. */
export const eetTranslationMeta = recordTranslationMeta;

type RecordTranslationRow = {
  stringId: number;
  text: string;
  status: string;
  confidence: number;
};

const bulkUpsertRecordTranslations = async (
  db: Tx,
  items: RecordTranslationRow[],
  targetLang: string,
  provenance: string,
): Promise<void> => {
  if (items.length === 0) return;

  const stringIds = items.map((p) => p.stringId);
  const texts = items.map((p) => p.text);
  const statuses = items.map((p) => p.status);
  const confidences = items.map((p) => p.confidence);

  await db.query(
    `INSERT INTO translations(
       src_string_id, target_lang, text, status, confidence, provenance, model, updated_at
     )
     SELECT s, $2, t, st, cf, $6, NULL, NOW()
     FROM UNNEST($1::int[], $3::text[], $4::text[], $5::float8[]) AS u(s, t, st, cf)
     ON CONFLICT(src_string_id, target_lang) DO UPDATE SET
       text = EXCLUDED.text,
       status = EXCLUDED.status,
       confidence = EXCLUDED.confidence,
       provenance = EXCLUDED.provenance,
       updated_at = NOW()`,
    [stringIds, targetLang, texts, statuses, confidences, provenance],
  );
};

/** Upsert records, insert source strings, and upsert target translations for one batch. */
export const bulkInsertRecordImportRows = async (
  db: Tx,
  modId: number,
  records: RecordImportRow[],
  srcLang: string,
  tgtLang: string,
  options: RecordImportBulkOptions,
): Promise<RecordImportBulkResult[]> => {
  if (records.length === 0) return [];

  type UniqueRecord = {
    signature: string;
    path: string;
    pathSimplified: string;
    edid: string | null;
    hashNorm: string;
    formId: string;
  };

  const uniqueRecords = new Map<string, UniqueRecord>();
  const stringInputs: Array<{
    recordKey: string;
    textRaw: string;
    textNorm: string;
    textNormNopunct: string | null;
  }> = [];

  for (const rec of records) {
    const recPath = rec.field || 'FULL';
    const formId = rec.formId || '';
    const textNorm = normalizeForHash(rec.source);
    const recordKey = modImportRecordKey(rec.signature, recPath, formId);

    uniqueRecords.set(recordKey, {
      signature: rec.signature,
      path: recPath,
      pathSimplified: recPath,
      edid: rec.edid || null,
      hashNorm: sha1Hex(textNorm),
      formId,
    });

    stringInputs.push({
      recordKey,
      textRaw: rec.source,
      textNorm,
      textNormNopunct: normalizeNoPunct(rec.source),
    });
  }

  const uniqueList = [...uniqueRecords.values()];
  const uModIds = uniqueList.map(() => modId);
  const uSignatures = uniqueList.map((r) => r.signature);
  const uPaths = uniqueList.map((r) => r.path);
  const uPathSimplified = uniqueList.map((r) => r.pathSimplified);
  const uEdids = uniqueList.map((r) => r.edid);
  const uHashNorms = uniqueList.map((r) => r.hashNorm);
  const uFormIds = uniqueList.map((r) => r.formId);

  await db.query(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     SELECT * FROM UNNEST(
       $1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[]
     )
     ON CONFLICT(mod_id, signature, path, formid_hex) DO UPDATE SET
       path_simplified = EXCLUDED.path_simplified,
       edid = COALESCE(EXCLUDED.edid, records.edid),
       hash_norm = EXCLUDED.hash_norm`,
    [uModIds, uSignatures, uPaths, uPathSimplified, uEdids, uHashNorms, uFormIds],
  );

  const { rows: recordRows } = await db.query<{
    id: number;
    signature: string;
    path: string;
    formid_hex: string;
  }>(
    `SELECT r.id, r.signature, r.path, r.formid_hex
     FROM UNNEST($1::text[], $2::text[], $3::text[]) AS i(signature, path, formid_hex)
     JOIN records r
       ON r.mod_id = $4
      AND r.signature = i.signature
      AND r.path = i.path
      AND r.formid_hex = i.formid_hex`,
    [uSignatures, uPaths, uFormIds, modId],
  );

  const recordIdByKey = new Map<string, number>();
  for (const row of recordRows) {
    recordIdByKey.set(modImportRecordKey(row.signature, row.path, row.formid_hex), row.id);
  }

  const recordIds = stringInputs.map((s) => {
    const id = recordIdByKey.get(s.recordKey);
    if (id == null) {
      throw new Error(`Record id not found after bulk upsert for key ${s.recordKey}`);
    }
    return id;
  });

  const langs = stringInputs.map(() => srcLang);
  const textRaws = stringInputs.map((s) => s.textRaw);
  const textNorms = stringInputs.map((s) => s.textNorm);
  const textNormNopunct = stringInputs.map((s) => s.textNormNopunct);
  const sourceKinds = stringInputs.map(() => options.sourceKind);
  const contexts = stringInputs.map(() => null);
  const lstringIds = stringInputs.map(() => null);

  const { rows: stringRows } = await db.query<{ id: number }>(
    `INSERT INTO strings(
       record_id, lang, lstring_id, text_raw, text_norm, source_kind, text_norm_nopunct, context
     )
     SELECT i.record_id, i.lang, i.lstring_id, i.text_raw, i.text_norm, i.source_kind, i.text_norm_nopunct, i.context
     FROM UNNEST(
       $1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]
     ) AS i(record_id, lang, lstring_id, text_raw, text_norm, source_kind, text_norm_nopunct, context)
     RETURNING id`,
    [recordIds, langs, lstringIds, textRaws, textNorms, sourceKinds, textNormNopunct, contexts],
  );

  const translationRows: RecordTranslationRow[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    if (!rec.target) continue;
    const meta = recordTranslationMeta(rec.status);
    translationRows.push({
      stringId: stringRows[i]!.id,
      text: rec.target,
      status: meta.status,
      confidence: meta.confidence,
    });
  }
  await bulkUpsertRecordTranslations(db, translationRows, tgtLang, options.provenance);

  return records.map((record, index) => ({
    recordId: recordIds[index]!,
    stringId: stringRows[index]!.id,
    record,
  }));
};

/** @deprecated Use {@link bulkInsertRecordImportRows}. */
export const bulkInsertEetImportRows = async (
  db: Tx,
  modId: number,
  records: RecordImportRow[],
  srcLang: string,
  tgtLang: string,
): Promise<RecordImportBulkResult[]> =>
  bulkInsertRecordImportRows(db, modId, records, srcLang, tgtLang, {
    sourceKind: 'eet',
    provenance: 'eet',
  });
