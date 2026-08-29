import type { Tx } from './types';

export const upsertRecord = async (
  db: Tx,
  modId: number,
  signature: string,
  path: string,
  pathSimplified: string,
  edid: string | null,
  hashNorm: string | null,
  formidHex: string | null,
): Promise<number> => {
  const fid = formidHex ?? '';
  const { rows } = await db.query(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(mod_id, signature, path, formid_hex) DO UPDATE SET
       path_simplified = EXCLUDED.path_simplified,
       edid = COALESCE(EXCLUDED.edid, records.edid),
       hash_norm = EXCLUDED.hash_norm
     RETURNING id`,
    [modId, signature, path, pathSimplified, edid, hashNorm, fid],
  );
  return rows[0].id;
};

export const insertString = async (
  db: Tx,
  recordId: number,
  lang: string,
  textRaw: string,
  textNorm: string,
  sourceKind = 'export',
  lstringId?: number | null,
  textNormNopunct?: string | null,
  context?: string | null,
): Promise<number> => {
  const { rows } = await db.query(
    `INSERT INTO strings(record_id, lang, lstring_id, text_raw, text_norm, source_kind, text_norm_nopunct, context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      recordId,
      lang,
      lstringId ?? null,
      textRaw,
      textNorm,
      sourceKind,
      textNormNopunct ?? null,
      context ?? null,
    ],
  );
  return rows[0].id;
};

export const findStringId = async (
  db: Tx,
  formidHex: string,
  path: string,
  lang: string,
): Promise<number | undefined> => {
  if (!formidHex) return undefined;
  const { rows } = await db.query(
    `SELECT s.id FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.formid_hex = $1 AND r.path = $2 AND s.lang = $3 LIMIT 1`,
    [formidHex, path, lang],
  );
  return rows[0]?.id;
};
