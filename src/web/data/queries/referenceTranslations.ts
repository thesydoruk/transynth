/**
 * Reference translations: the part of the translation memory that survives
 * mod deletion. See `reference_translations` in sql/schema.sql.
 */
import type { Tx } from '../../../db/types';
import { CONFIG } from '../../../config';
import { referenceGameKey, referenceGameSql } from '../../../games/referenceKey';
import { normalizeForHash } from '../../../utils/textNorm';

export type ReferenceOrigin = 'manual' | 'promote' | 'delete_snapshot' | 'auto_approve';

/** Statuses a promotion takes by default: the same ones the RAG index trusts. */
export const REFERENCE_PROMOTE_STATUSES: readonly string[] = ['reviewed', 'human'];

export type ReferenceTranslationRow = {
  id: number;
  game: string;
  src_lang: string;
  tgt_lang: string;
  formid_hex: string;
  path: string;
  edid: string;
  signature: string | null;
  source_text: string;
  translation: string;
  origin: string;
  origin_mod_name: string | null;
  origin_mod_version: string | null;
  origin_status: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT_COLUMNS = `id, game, src_lang, tgt_lang, formid_hex, path, edid, signature,
  source_text, translation, origin, origin_mod_name, origin_mod_version, origin_status, note,
  created_at, updated_at`;

export type ListReferenceParams = {
  game?: string | null;
  srcLang?: string;
  tgtLang?: string;
  q?: string;
  limit?: number;
  offset?: number;
};

const MAX_LIST_LIMIT = 500;

/** WHERE clause shared by list and count. Exported for tests. */
export const referenceListWhere = (
  params: ListReferenceParams,
): { sql: string; values: unknown[] } => {
  const conditions: string[] = ['game = $1'];
  const values: unknown[] = [referenceGameKey(params.game)];
  if (params.srcLang) {
    values.push(params.srcLang);
    conditions.push(`src_lang = $${values.length}`);
  }
  if (params.tgtLang) {
    values.push(params.tgtLang);
    conditions.push(`tgt_lang = $${values.length}`);
  }
  const q = params.q?.trim();
  if (q) {
    values.push(`%${q}%`);
    const n = values.length;
    conditions.push(`(source_text ILIKE $${n} OR translation ILIKE $${n} OR edid ILIKE $${n})`);
  }
  return { sql: conditions.join(' AND '), values };
};

export const listReferenceTranslations = async (
  db: Tx,
  params: ListReferenceParams,
): Promise<{ rows: ReferenceTranslationRow[]; total: number }> => {
  const where = referenceListWhere(params);
  const limit = Math.min(Math.max(1, params.limit ?? MAX_LIST_LIMIT), MAX_LIST_LIMIT);
  const offset = Math.max(0, params.offset ?? 0);
  const { rows: countRows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reference_translations WHERE ${where.sql}`,
    where.values,
  );
  const { rows } = await db.query<ReferenceTranslationRow>(
    `SELECT ${SELECT_COLUMNS} FROM reference_translations
     WHERE ${where.sql}
     ORDER BY updated_at DESC, id DESC
     LIMIT $${where.values.length + 1} OFFSET $${where.values.length + 2}`,
    [...where.values, limit, offset],
  );
  return { rows, total: countRows[0]?.n ?? 0 };
};

/** Row count for one game and language pair, for the game hub card. */
export const countReferenceTranslations = async (
  db: Tx,
  game: string | null | undefined,
  srcLang = CONFIG.defaultSrcLang,
  tgtLang = CONFIG.defaultTgtLang,
): Promise<number> => {
  const { rows } = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM reference_translations
     WHERE game = $1 AND src_lang = $2 AND tgt_lang = $3`,
    [referenceGameKey(game), srcLang, tgtLang],
  );
  return rows[0]?.n ?? 0;
};

export type ManualReferenceInput = {
  game?: string | null;
  srcLang: string;
  tgtLang: string;
  sourceText: string;
  translation: string;
  note?: string | null;
};

/**
 * Add a row by hand. No anchors: the row matches by normalised source text
 * only. Re-adding the same source text replaces the translation.
 */
export const addManualReferenceTranslation = async (
  db: Tx,
  input: ManualReferenceInput,
): Promise<ReferenceTranslationRow> => {
  const sourceText = input.sourceText.trim();
  const translation = input.translation.trim();
  const { rows } = await db.query<ReferenceTranslationRow>(
    `INSERT INTO reference_translations(
       game, src_lang, tgt_lang, source_text, text_norm, translation, origin, note
     )
     VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)
     ON CONFLICT (game, src_lang, tgt_lang, formid_hex, path, source_text) DO UPDATE SET
       translation = EXCLUDED.translation,
       text_norm = EXCLUDED.text_norm,
       origin = 'manual',
       note = COALESCE(EXCLUDED.note, reference_translations.note),
       updated_at = NOW()
     RETURNING ${SELECT_COLUMNS}`,
    [
      referenceGameKey(input.game),
      input.srcLang,
      input.tgtLang,
      sourceText,
      normalizeForHash(sourceText),
      translation,
      input.note ?? null,
    ],
  );
  return rows[0]!;
};

export type UpdateReferenceInput = {
  sourceText?: string;
  translation?: string;
  note?: string | null;
};

/** Edit a row on the Reference page. The row becomes `manual` and stays that way. */
export const updateReferenceTranslation = async (
  db: Tx,
  id: number,
  input: UpdateReferenceInput,
): Promise<ReferenceTranslationRow | null> => {
  const sourceText = input.sourceText?.trim();
  const translation = input.translation?.trim();
  const { rows } = await db.query<ReferenceTranslationRow>(
    `UPDATE reference_translations SET
       source_text = COALESCE($2, source_text),
       text_norm = COALESCE($3, text_norm),
       translation = COALESCE($4, translation),
       note = CASE WHEN $6 THEN $5 ELSE note END,
       origin = 'manual',
       updated_at = NOW()
     WHERE id = $1
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      sourceText || null,
      sourceText ? normalizeForHash(sourceText) : null,
      translation || null,
      input.note ?? null,
      input.note !== undefined,
    ],
  );
  return rows[0] ?? null;
};

export const deleteReferenceTranslations = async (db: Tx, ids: number[]): Promise<number> => {
  if (ids.length === 0) return 0;
  const { rowCount } = await db.query(
    `DELETE FROM reference_translations WHERE id = ANY($1::int[])`,
    [ids],
  );
  return rowCount ?? 0;
};

export type PromoteReferenceOptions = {
  /** Promote every eligible translation of these mods … */
  modIds?: number[];
  /** … or only these strings. One of the two is required. */
  stringIds?: number[];
  targetLang?: string;
  /** Translation statuses eligible for promotion. Default: reviewed, human. */
  statuses?: readonly string[];
  origin: Exclude<ReferenceOrigin, 'manual'>;
};

/**
 * Copy live translations into the reference base.
 *
 * One INSERT … SELECT over the scope. An existing reference row is replaced
 * unless it was edited by hand (`origin = 'manual'`). Returns the number of
 * rows written.
 */
export const promoteTranslationsToReference = async (
  db: Tx,
  opts: PromoteReferenceOptions,
): Promise<number> => {
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;
  const statuses = [...(opts.statuses ?? REFERENCE_PROMOTE_STATUSES)];
  const byMod = opts.modIds !== undefined;
  const scopeIds = byMod ? opts.modIds : opts.stringIds;
  if (!scopeIds || scopeIds.length === 0) return 0;

  const gameSql = referenceGameSql('m.game');
  const keySql = `${gameSql}, s.lang, t.target_lang, COALESCE(r.formid_hex, ''), COALESCE(r.path, ''), s.text_raw`;
  const scopeSql = byMod ? 'r.mod_id = ANY($1::int[])' : 's.id = ANY($1::int[])';
  const { rowCount } = await db.query(
    `INSERT INTO reference_translations(
       game, src_lang, tgt_lang, formid_hex, path, edid, signature,
       source_text, text_norm, translation, origin,
       origin_mod_name, origin_mod_version, origin_status
     )
     SELECT DISTINCT ON (${keySql})
       ${gameSql}, s.lang, t.target_lang,
       COALESCE(r.formid_hex, ''), COALESCE(r.path, ''), COALESCE(r.edid, ''), r.signature,
       s.text_raw, COALESCE(s.text_norm, ''), t.text, $4,
       m.name, COALESCE(m.version_label, m.version_hash), t.status
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     WHERE ${scopeSql}
       AND t.target_lang = $2
       AND t.status = ANY($3::text[])
       AND s.is_ignored = FALSE
       AND t.text <> ''
     ORDER BY ${keySql},
              CASE t.status WHEN 'reviewed' THEN 0 ELSE 1 END, t.updated_at DESC
     ON CONFLICT (game, src_lang, tgt_lang, formid_hex, path, source_text) DO UPDATE SET
       translation = EXCLUDED.translation,
       text_norm = EXCLUDED.text_norm,
       edid = EXCLUDED.edid,
       signature = EXCLUDED.signature,
       origin = EXCLUDED.origin,
       origin_mod_name = EXCLUDED.origin_mod_name,
       origin_mod_version = EXCLUDED.origin_mod_version,
       origin_status = EXCLUDED.origin_status,
       updated_at = NOW()
     WHERE reference_translations.origin <> 'manual'`,
    [scopeIds, targetLang, statuses, opts.origin],
  );
  return rowCount ?? 0;
};
