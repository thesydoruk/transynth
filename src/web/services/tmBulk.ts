/**
 * Bulk translation-memory matching and writes for large mods.
 *
 * Replaces per-row findBestMatch + upsertTranslation with set-based SQL
 * (one match query + one upsert per batch).
 */
import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import {
  bulkRecordTranslationRevisions,
  tmRevisionNoteForProvenance,
} from '../data/translationRevisions';
import { adaptTmTranslation } from './tmAdapt';

export type TmMatchMethod = 'anchor' | 'edid' | 'text_norm' | 'numeric';

export type TmUntranslatedRow = {
  id: number;
  text_raw: string;
  text_norm: string;
  formid_hex: string | null;
  path: string;
  edid: string | null;
};

export type TmBulkMatch = {
  stringId: number;
  text: string;
  method: TmMatchMethod;
  confidence: number;
};

const TM_TRANSLATION_STATUS_ORDER = `CASE tr.status
  WHEN 'reviewed' THEN 1
  WHEN 'human' THEN 2
  WHEN 'tm' THEN 3
  WHEN 'fuzzy' THEN 4
  WHEN 'auto' THEN 5
  WHEN 'draft' THEN 6
  ELSE 7 END`;

const METHOD_META: Record<TmMatchMethod, { rank: number; confidence: number; provenance: string }> =
  {
    anchor: { rank: 1, confidence: 0.95, provenance: 'tm_auto_anchor' },
    edid: { rank: 2, confidence: 0.85, provenance: 'tm_auto_edid' },
    text_norm: { rank: 3, confidence: 0.75, provenance: 'tm_auto_text_norm' },
    numeric: { rank: 4, confidence: 0.72, provenance: 'tm_auto_numeric' },
  };

export const tmProvenanceForMethod = (method: TmMatchMethod): string =>
  METHOD_META[method].provenance;

export const tmConfidenceForMethod = (method: TmMatchMethod): number =>
  METHOD_META[method].confidence;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const emptyByMethod = (): Record<TmMatchMethod, number> => ({
  anchor: 0,
  edid: 0,
  text_norm: 0,
  numeric: 0,
});

/**
 * Find best TM match per untranslated string using anchor → edid → text_norm priority.
 * One SQL round-trip per batch (replaces up to 3×N per-row lookups).
 *
 * When the matched source differs from the target only by numbers, the translation
 * is adapted via number transplant. Unsafe adaptations are skipped.
 */
export const bulkFindTmMatches = async (
  db: Tx,
  modId: number,
  rows: TmUntranslatedRow[],
  targetLang: string,
  srcLang: string,
): Promise<TmBulkMatch[]> => {
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const formIds = rows.map((r) => r.formid_hex ?? '');
  const paths = rows.map((r) => r.path);
  const edids = rows.map((r) => r.edid ?? '');
  const textNorms = rows.map((r) => r.text_norm);
  const textRaws = rows.map((r) => r.text_raw);
  const targetById = new Map(rows.map((r) => [r.id, r]));

  const { rows: matchRows } = await db.query<{
    target_id: number;
    text: string;
    match_source: string;
    method: 'anchor' | 'edid' | 'text_norm';
  }>(
    `WITH targets AS (
       SELECT *
       FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS u(id, formid_hex, path, edid, text_norm, text_raw)
     ),
     candidates AS (
       SELECT t.id AS target_id, tr.text, s.text_raw AS match_source, 1 AS method_rank,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY CASE WHEN s.text_raw = t.text_raw THEN 0 ELSE 1 END,
                    ${TM_TRANSLATION_STATUS_ORDER},
                    COALESCE(tr.confidence, 0) DESC,
                    tr.updated_at DESC
         ) AS rn
       FROM targets t
       JOIN records r
         ON r.formid_hex = t.formid_hex
        AND r.path = t.path
        AND r.mod_id != $7
       JOIN strings s ON s.record_id = r.id AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       WHERE NULLIF(t.formid_hex, '') IS NOT NULL

       UNION ALL

       SELECT t.id, tr.text, s.text_raw, 2,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY CASE WHEN s.text_raw = t.text_raw THEN 0 ELSE 1 END,
                    ${TM_TRANSLATION_STATUS_ORDER},
                    COALESCE(tr.confidence, 0) DESC,
                    tr.updated_at DESC
         ) AS rn
       FROM targets t
       JOIN records r ON r.edid = t.edid AND r.mod_id != $7
       JOIN strings s ON s.record_id = r.id AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       WHERE NULLIF(t.edid, '') IS NOT NULL

       UNION ALL

       SELECT t.id, tr.text, s.text_raw, 3,
         ROW_NUMBER() OVER (
           PARTITION BY t.id
           ORDER BY CASE WHEN s.text_raw = t.text_raw THEN 0 ELSE 1 END,
                    ${TM_TRANSLATION_STATUS_ORDER},
                    COALESCE(tr.confidence, 0) DESC,
                    tr.updated_at DESC
         ) AS rn
       FROM targets t
       JOIN strings s ON s.text_norm = t.text_norm AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       WHERE NULLIF(t.text_norm, '') IS NOT NULL
     ),
     best_per_method AS (
       SELECT target_id, text, match_source, method_rank
       FROM candidates
       WHERE rn = 1
     )
     SELECT DISTINCT ON (b.target_id)
       b.target_id, b.text, b.match_source,
       CASE b.method_rank
         WHEN 1 THEN 'anchor'
         WHEN 2 THEN 'edid'
         ELSE 'text_norm'
       END AS method
     FROM best_per_method b
     ORDER BY b.target_id, b.method_rank`,
    [ids, formIds, paths, edids, textNorms, textRaws, modId, targetLang, srcLang],
  );

  const adapted: TmBulkMatch[] = [];
  for (const row of matchRows) {
    const target = targetById.get(row.target_id);
    if (!target) continue;

    const text = adaptTmTranslation(row.text, row.match_source, target.text_raw);
    if (text === null) continue;

    const method: TmMatchMethod =
      row.method === 'text_norm' && row.match_source !== target.text_raw ? 'numeric' : row.method;

    adapted.push({
      stringId: row.target_id,
      text,
      method,
      confidence: tmConfidenceForMethod(method),
    });
  }
  return adapted;
};

export type TmBulkWriteRow = {
  stringId: number;
  text: string;
  provenance: string;
  confidence: number;
};

/** TM bulk upsert with revision history (no inline QA or RAG). */
export const bulkUpsertTmTranslations = async (
  db: Tx,
  items: TmBulkWriteRow[],
  targetLang: string,
  batchSize = CONFIG.dbChunkSize,
): Promise<number> => {
  if (items.length === 0) return 0;

  let total = 0;
  for (const part of chunk(items, batchSize)) {
    const stringIds = part.map((p) => p.stringId);
    const texts = part.map((p) => p.text);
    const confidences = part.map((p) => p.confidence);
    const provenances = part.map((p) => p.provenance);

    await db.query(
      `DELETE FROM translations WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
      [stringIds, targetLang],
    );
    const { rows: inserted } = await db.query<{
      id: number;
      src_string_id: number;
      text: string;
      provenance: string | null;
    }>(
      `INSERT INTO translations(
         src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
       )
       SELECT s, $2, t, 'tm', cf, p, NULL, NULL, NOW()
       FROM UNNEST($1::int[], $3::text[], $4::float8[], $5::text[]) AS u(s, t, cf, p)
       RETURNING id, src_string_id, text, provenance`,
      [stringIds, targetLang, texts, confidences, provenances],
    );

    await bulkRecordTranslationRevisions(
      db,
      inserted.map((row) => ({
        stringId: row.src_string_id,
        translationId: row.id,
        targetLang,
        text: row.text,
        status: 'tm',
        provenance: row.provenance,
        model: null,
        note: tmRevisionNoteForProvenance(row.provenance ?? 'tm_auto'),
      })),
    );

    total += part.length;
  }
  return total;
};

/** Match and persist TM hits for one batch of untranslated rows. */
export const bulkApplyTmBatch = async (
  db: Tx,
  modId: number,
  rows: TmUntranslatedRow[],
  targetLang: string,
  srcLang: string,
): Promise<{ applied: number; byMethod: Record<TmMatchMethod, number> }> => {
  const byMethod = emptyByMethod();
  if (rows.length === 0) return { applied: 0, byMethod };

  const matches = await bulkFindTmMatches(db, modId, rows, targetLang, srcLang);
  if (matches.length === 0) return { applied: 0, byMethod };

  const writeRows: TmBulkWriteRow[] = matches.map((m) => ({
    stringId: m.stringId,
    text: m.text,
    provenance: tmProvenanceForMethod(m.method),
    confidence: m.confidence,
  }));
  await bulkUpsertTmTranslations(db, writeRows, targetLang);

  for (const match of matches) {
    byMethod[match.method]++;
  }

  return { applied: matches.length, byMethod };
};
