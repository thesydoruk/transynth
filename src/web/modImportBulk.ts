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

export type DialogGraphImportContext = {
  dialogEdidByFormId: Map<string, string>;
  speakerMap: Map<string, string>;
  voiceSpeakerMap: Map<string, string>;
  topicIdCache: Map<string, number>;
};

/** Bulk upsert DIAL/INFO dialog graph rows for one import batch (replaces per-row upserts). */
export const bulkUpsertDialogGraphForImportBatch = async (
  db: Tx,
  modId: number,
  results: ModImportBulkResult[],
  ctx: DialogGraphImportContext,
): Promise<void> => {
  type InfoRow = {
    topicFormId: string;
    infoFormId: string;
    stringId: number;
    speakerFormId: string | null;
    speakerName: string | null;
    previousInfoFormId: string | null;
  };

  const infoRows: InfoRow[] = [];
  for (const res of results) {
    const row = res.row.csvRow;
    if (row.Signature !== 'INFO' || !row.FormID || !row.DialogTopicFormID) continue;

    const speakerFormId = row.SpeakerFormID ?? ctx.speakerMap.get(row.FormID) ?? null;
    const speakerName = res.row.context ?? ctx.voiceSpeakerMap.get(row.FormID.substring(2)) ?? null;

    infoRows.push({
      topicFormId: row.DialogTopicFormID,
      infoFormId: row.FormID,
      stringId: res.stringId,
      speakerFormId,
      speakerName,
      previousInfoFormId: row.PreviousInfoFormID ?? null,
    });
  }

  if (infoRows.length === 0) return;

  const missingTopicFormIds = [
    ...new Set(infoRows.map((row) => row.topicFormId).filter((fid) => !ctx.topicIdCache.has(fid))),
  ];

  if (missingTopicFormIds.length > 0) {
    const modIds = missingTopicFormIds.map(() => modId);
    const edids = missingTopicFormIds.map((fid) => ctx.dialogEdidByFormId.get(fid) ?? null);
    const { rows: topicRows } = await db.query<{ id: number; formid_hex: string }>(
      `INSERT INTO dialog_topics(mod_id, formid_hex, edid)
       SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[])
       ON CONFLICT(mod_id, formid_hex) DO UPDATE SET
         edid = COALESCE(EXCLUDED.edid, dialog_topics.edid)
       RETURNING id, formid_hex`,
      [modIds, missingTopicFormIds, edids],
    );
    for (const topic of topicRows) {
      ctx.topicIdCache.set(topic.formid_hex, topic.id);
    }
  }

  const topicIds: number[] = [];
  const infoFormIds: string[] = [];
  const stringIds: number[] = [];
  const speakerFormIds: Array<string | null> = [];
  const speakerNames: Array<string | null> = [];
  const previousInfoFormIds: Array<string | null> = [];

  for (const info of infoRows) {
    const topicId = ctx.topicIdCache.get(info.topicFormId);
    if (topicId == null) {
      throw new Error(`Dialog topic id missing after upsert for ${info.topicFormId}`);
    }
    topicIds.push(topicId);
    infoFormIds.push(info.infoFormId);
    stringIds.push(info.stringId);
    speakerFormIds.push(info.speakerFormId);
    speakerNames.push(info.speakerName);
    previousInfoFormIds.push(info.previousInfoFormId);
  }

  await db.query(
    `INSERT INTO dialog_nodes(
       topic_id, info_formid_hex, response_string_id, speaker_formid_hex, speaker_name, previous_info_formid_hex
     )
     SELECT * FROM UNNEST(
       $1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[]
     )
     ON CONFLICT(topic_id, info_formid_hex) DO UPDATE SET
       response_string_id = COALESCE(dialog_nodes.response_string_id, EXCLUDED.response_string_id),
       speaker_formid_hex = COALESCE(EXCLUDED.speaker_formid_hex, dialog_nodes.speaker_formid_hex),
       speaker_name = COALESCE(EXCLUDED.speaker_name, dialog_nodes.speaker_name),
       previous_info_formid_hex = COALESCE(EXCLUDED.previous_info_formid_hex, dialog_nodes.previous_info_formid_hex),
       updated_at = NOW()`,
    [topicIds, infoFormIds, stringIds, speakerFormIds, speakerNames, previousInfoFormIds],
  );

  const edgeTopicIds: number[] = [];
  const fromInfoFormIds: string[] = [];
  const toInfoFormIds: string[] = [];

  for (let i = 0; i < infoRows.length; i++) {
    const previous = infoRows[i]!.previousInfoFormId;
    if (!previous) continue;
    edgeTopicIds.push(topicIds[i]!);
    fromInfoFormIds.push(previous);
    toInfoFormIds.push(infoFormIds[i]!);
  }

  if (edgeTopicIds.length === 0) return;

  const edgeKinds = edgeTopicIds.map(() => 'previous');
  const confidences = edgeTopicIds.map(() => 'exact');

  await db.query(
    `INSERT INTO dialog_edges(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind, confidence)
     SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind) DO UPDATE SET
       confidence = EXCLUDED.confidence`,
    [edgeTopicIds, fromInfoFormIds, toInfoFormIds, edgeKinds, confidences],
  );
};

/** Natural key for `records` upsert (matches ON CONFLICT target). */
export const modImportRecordKey = (signature: string, path: string, formId: string): string =>
  `${signature}\0${path}\0${formId}`;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

type UniqueRecord = {
  signature: string;
  path: string;
  pathSimplified: string;
  edid: string | null;
  hashNorm: string;
  formId: string;
};

/** Upsert records and insert strings for one import batch. */
export const bulkInsertModImportRows = async (
  db: Tx,
  modId: number,
  rows: ModImportBulkRow[],
): Promise<ModImportBulkResult[]> => {
  if (rows.length === 0) return [];

  const uniqueRecords = new Map<string, UniqueRecord>();
  const stringInputs: Array<{
    recordKey: string;
    locale: string;
    textRaw: string;
    textNorm: string;
    textNormNopunct: string | null;
    sourceKind: string;
    context: string | null;
    lstringId: number | null;
  }> = [];

  for (const item of rows) {
    const r = item.csvRow;
    const pathS = r.PathSimplified ?? r.Path.replace(/\[\d+\]/g, '');
    const formId = r.FormID || '';
    const textNorm = normalizeForHash(r.Source);
    const recordKey = modImportRecordKey(r.Signature, r.Path, formId);

    uniqueRecords.set(recordKey, {
      signature: r.Signature,
      path: r.Path,
      pathSimplified: pathS,
      edid: r.EDID ?? null,
      hashNorm: sha1Hex(textNorm),
      formId,
    });

    stringInputs.push({
      recordKey,
      locale: item.locale,
      textRaw: r.Source,
      textNorm,
      textNormNopunct: normalizeNoPunct(r.Source),
      sourceKind: item.sourceKind ?? 'mod-import',
      context: item.context,
      lstringId: r.LStringID ?? null,
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

  const langs = stringInputs.map((s) => s.locale);
  const textRaws = stringInputs.map((s) => s.textRaw);
  const textNorms = stringInputs.map((s) => s.textNorm);
  const textNormNopunct = stringInputs.map((s) => s.textNormNopunct);
  const sourceKinds = stringInputs.map((s) => s.sourceKind);
  const contexts = stringInputs.map((s) => s.context);
  const lstringIds = stringInputs.map((s) => s.lstringId);

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

/** Deduplicate by src_string_id (last text wins) before bulk insert. */
export const dedupeBulkTranslationRows = (items: BulkTranslationRow[]): BulkTranslationRow[] => {
  const byId = new Map<number, string>();
  for (const item of items) byId.set(item.srcStringId, item.text);
  return [...byId.entries()].map(([srcStringId, text]) => ({ srcStringId, text }));
};

/** Fast translation upsert (no revision, QA, or RAG). */
const bulkUpsertTranslationsCore = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  provenance: string,
  status: string,
  batchSize: number,
  model: string | null,
): Promise<number> => {
  const deduped = dedupeBulkTranslationRows(items);
  let total = 0;
  for (const part of chunk(deduped, batchSize)) {
    if (part.length === 0) continue;
    const stringIds = part.map((p) => p.srcStringId);
    const texts = part.map((p) => p.text);
    await db.query(
      `DELETE FROM translations WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
      [stringIds, targetLang],
    );
    await db.query(
      `INSERT INTO translations(
         src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
       )
       SELECT s, $3, t, $5, 1.0, $4, $6, NULL, NOW()
       FROM UNNEST($1::int[], $2::text[]) AS u(s, t)`,
      [stringIds, texts, targetLang, provenance, status, model],
    );
    total += part.length;
  }
  return total;
};

/** Fast translation upsert for import pipelines (no RAG, revision, or QA). */
export const bulkUpsertImportTranslations = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  provenance: string,
  batchSize = 1000,
  status = 'reviewed',
): Promise<number> =>
  bulkUpsertTranslationsCore(db, items, targetLang, provenance, status, batchSize, null);

/**
 * Fast bulk upsert for LLM auto-translate (no revision, RAG sync, or inline QA).
 * QA is refreshed asynchronously via scheduleRefreshQAIssuesBatch in qaHooks.ts.
 */
export const bulkUpsertAutoTranslations = async (
  db: Tx,
  items: BulkTranslationRow[],
  targetLang: string,
  model: string,
  batchSize = 1000,
): Promise<number> =>
  bulkUpsertTranslationsCore(db, items, targetLang, 'auto_generated', 'auto', batchSize, model);
