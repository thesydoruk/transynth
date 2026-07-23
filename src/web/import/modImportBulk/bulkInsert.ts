import type { Tx } from '../../../db';
import { sha1Hex } from '../../../utils/hash';
import { normalizeForHash, normalizeNoPunct } from '../../../utils/textNorm';
import { modImportRecordKey } from './recordKeys';
import type { ModImportBulkResult, ModImportBulkRow } from './types';

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
