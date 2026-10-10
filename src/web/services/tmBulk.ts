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
import type { GameId } from '../../types';
import { referenceGameKey } from '../../games/referenceKey';

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
  /** Donor mod when the match came from another imported plugin; null for a reference row. */
  sourceModId: number | null;
  /** True when the donor source string is byte-for-byte the same as the target. */
  exactSourceText: boolean;
  /** True when the translation came from the per-game reference base. */
  fromReference: boolean;
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

/** `tm_auto_<method>` for a live-mod hit, `tm_reference_<method>` for the reference base. */
export const tmProvenanceForMethod = (method: TmMatchMethod, fromReference = false): string =>
  fromReference ? `tm_reference_${method}` : METHOD_META[method].provenance;

/**
 * A reference row was reviewed once already; asking for a second review on an
 * identical source text defeats the base. A number transplant is new text and
 * stays `tm`.
 */
export const tmStatusForMatch = (match: TmBulkMatch): 'tm' | 'reviewed' =>
  match.fromReference && match.exactSourceText ? 'reviewed' : 'tm';

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
 * Rank candidates inside one (target, method) partition: an identical source
 * text first, then status.
 */
const TM_CANDIDATE_ORDER = `ORDER BY CASE WHEN s.text_raw = t.text_raw THEN 0 ELSE 1 END,
                    ${TM_TRANSLATION_STATUS_ORDER},
                    COALESCE(tr.confidence, 0) DESC,
                    tr.updated_at DESC`;

const TM_REFERENCE_ORDER = `ORDER BY CASE WHEN rt.source_text = t.text_raw THEN 0 ELSE 1 END,
                    rt.updated_at DESC`;

/**
 * Find best TM match per untranslated string using anchor → edid → text_norm priority.
 * One SQL round-trip per batch (replaces up to 3×N per-row lookups).
 *
 * Each method looks in two places: the per-game reference base, which wins
 * over a live mod on the same anchor, and other imported mods. When the
 * matched source differs from the target only by numbers, the translation is
 * adapted via number transplant. Unsafe adaptations are skipped.
 */
const bulkFindTmMatches = async (
  db: Tx,
  modId: number,
  rows: TmUntranslatedRow[],
  targetLang: string,
  srcLang: string,
  game: GameId,
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
    source_mod_id: number | null;
    from_reference: boolean;
    method: 'anchor' | 'edid' | 'text_norm';
  }>(
    `WITH targets AS (
       SELECT *
       FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
         AS u(id, formid_hex, path, edid, text_norm, text_raw)
     ),
     reference AS (
       SELECT t.id AS target_id, rt.translation AS text, rt.source_text AS match_source,
         1 AS method_rank,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
       FROM targets t
       JOIN reference_translations rt
         ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
        AND rt.formid_hex = t.formid_hex AND rt.path = t.path
       WHERE NULLIF(t.formid_hex, '') IS NOT NULL

       UNION ALL

       SELECT t.id, rt.translation, rt.source_text, 2,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
       FROM targets t
       JOIN reference_translations rt
         ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
        AND rt.edid = t.edid AND rt.path = t.path
       WHERE NULLIF(t.edid, '') IS NOT NULL

       UNION ALL

       SELECT t.id, rt.translation, rt.source_text, 3,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_REFERENCE_ORDER}) AS rn
       FROM targets t
       JOIN reference_translations rt
         ON rt.game = $10 AND rt.src_lang = $9 AND rt.tgt_lang = $8
        AND rt.text_norm = t.text_norm
       WHERE NULLIF(t.text_norm, '') IS NOT NULL
     ),
     live AS (
       SELECT t.id AS target_id, tr.text, s.text_raw AS match_source, r.mod_id AS source_mod_id,
         1 AS method_rank,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
       FROM targets t
       JOIN records r
         ON r.formid_hex = t.formid_hex
        AND r.path = t.path
        AND r.mod_id != $7
       JOIN strings s ON s.record_id = r.id AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       WHERE NULLIF(t.formid_hex, '') IS NOT NULL

       UNION ALL

       SELECT t.id, tr.text, s.text_raw, r.mod_id, 2,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
       FROM targets t
       JOIN records r ON r.edid = t.edid AND r.mod_id != $7
       JOIN strings s ON s.record_id = r.id AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       WHERE NULLIF(t.edid, '') IS NOT NULL

       UNION ALL

       SELECT t.id, tr.text, s.text_raw, r.mod_id, 3,
         ROW_NUMBER() OVER (PARTITION BY t.id ${TM_CANDIDATE_ORDER}) AS rn
       FROM targets t
       JOIN strings s ON s.text_norm = t.text_norm AND s.lang = $9
       JOIN translations tr ON tr.src_string_id = s.id AND tr.target_lang = $8
       JOIN records r ON r.id = s.record_id
       WHERE NULLIF(t.text_norm, '') IS NOT NULL
     ),
     best_per_method AS (
       -- Inside one method the reference base (source_rank 0) beats live mods,
       -- unless a live mod has the identical source text and the reference
       -- row does not: exactness still comes first.
       SELECT DISTINCT ON (c.target_id, c.method_rank)
         c.target_id, c.text, c.match_source, c.source_mod_id, c.method_rank, c.source_rank
       FROM (
         SELECT target_id, text, match_source, NULL::int AS source_mod_id, method_rank,
                0 AS source_rank
         FROM reference WHERE rn = 1
         UNION ALL
         SELECT target_id, text, match_source, source_mod_id, method_rank, 1
         FROM live WHERE rn = 1
       ) c
       JOIN targets t ON t.id = c.target_id
       ORDER BY c.target_id, c.method_rank,
                CASE WHEN c.match_source = t.text_raw THEN 0 ELSE 1 END,
                c.source_rank
     )
     SELECT DISTINCT ON (b.target_id)
       b.target_id, b.text, b.match_source, b.source_mod_id,
       (b.source_rank = 0) AS from_reference,
       CASE b.method_rank
         WHEN 1 THEN 'anchor'
         WHEN 2 THEN 'edid'
         ELSE 'text_norm'
       END AS method
     FROM best_per_method b
     ORDER BY b.target_id, b.method_rank`,
    [
      ids,
      formIds,
      paths,
      edids,
      textNorms,
      textRaws,
      modId,
      targetLang,
      srcLang,
      referenceGameKey(game),
    ],
  );

  const adapted: TmBulkMatch[] = [];
  for (const row of matchRows) {
    const target = targetById.get(row.target_id);
    if (!target) continue;

    const text = adaptTmTranslation(row.text, row.match_source, target.text_raw, game);
    if (text === null) continue;

    const method: TmMatchMethod =
      row.method === 'text_norm' && row.match_source !== target.text_raw ? 'numeric' : row.method;

    adapted.push({
      stringId: row.target_id,
      text,
      method,
      confidence: tmConfidenceForMethod(method),
      sourceModId: row.source_mod_id,
      exactSourceText: row.match_source === target.text_raw,
      fromReference: row.from_reference,
    });
  }
  return adapted;
};

export type TmBulkWriteRow = {
  stringId: number;
  text: string;
  provenance: string;
  confidence: number;
  /** Default `tm`. `reviewed` for an exact hit from the reference base. */
  status?: 'tm' | 'reviewed';
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
    const statuses = part.map((p) => p.status ?? 'tm');

    await db.query(
      `DELETE FROM translations WHERE src_string_id = ANY($1::int[]) AND target_lang = $2`,
      [stringIds, targetLang],
    );
    const { rows: inserted } = await db.query<{
      id: number;
      src_string_id: number;
      text: string;
      status: 'tm' | 'reviewed';
      provenance: string | null;
    }>(
      `INSERT INTO translations(
         src_string_id, target_lang, text, status, confidence, provenance, model, user_id, updated_at
       )
       SELECT s, $2, t, st, cf, p, NULL, NULL, NOW()
       FROM UNNEST($1::int[], $3::text[], $4::float8[], $5::text[], $6::text[]) AS u(s, t, cf, p, st)
       RETURNING id, src_string_id, text, status, provenance`,
      [stringIds, targetLang, texts, confidences, provenances, statuses],
    );

    await bulkRecordTranslationRevisions(
      db,
      inserted.map((row) => ({
        stringId: row.src_string_id,
        translationId: row.id,
        targetLang,
        text: row.text,
        status: row.status,
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
export const exactTmVoiceSourceModIds = (matches: TmBulkMatch[], destModId: number): number[] => {
  const ids = new Set<number>();
  for (const match of matches) {
    if (match.method === 'numeric' || !match.exactSourceText) continue;
    if (match.sourceModId == null || match.sourceModId === destModId) continue;
    ids.add(match.sourceModId);
  }
  return [...ids];
};

export const bulkApplyTmBatch = async (
  db: Tx,
  modId: number,
  rows: TmUntranslatedRow[],
  targetLang: string,
  srcLang: string,
  game: GameId,
): Promise<{
  applied: number;
  /** Rows written as `reviewed` straight from the reference base. */
  approved: number;
  byMethod: Record<TmMatchMethod, number>;
  sourceModIds: number[];
}> => {
  const byMethod = emptyByMethod();
  if (rows.length === 0) return { applied: 0, approved: 0, byMethod, sourceModIds: [] };

  const matches = await bulkFindTmMatches(db, modId, rows, targetLang, srcLang, game);
  if (matches.length === 0) return { applied: 0, approved: 0, byMethod, sourceModIds: [] };

  const writeRows: TmBulkWriteRow[] = matches.map((m) => ({
    stringId: m.stringId,
    text: m.text,
    provenance: tmProvenanceForMethod(m.method, m.fromReference),
    confidence: m.confidence,
    status: tmStatusForMatch(m),
  }));
  await bulkUpsertTmTranslations(db, writeRows, targetLang);

  let approved = 0;
  for (const match of matches) {
    byMethod[match.method]++;
    if (tmStatusForMatch(match) === 'reviewed') approved++;
  }

  return {
    applied: matches.length,
    approved,
    byMethod,
    sourceModIds: exactTmVoiceSourceModIds(matches, modId),
  };
};
