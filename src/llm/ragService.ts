/**
 * Translation RAG — indexes reviewed/human translations and retrieves
 * similar examples as few-shot context for LLM translation.
 *
 * Retrieval is hybrid:
 * 1. TM-style trigram / text_norm matches (cheap, PostgreSQL pg_trgm)
 * 2. pgvector cosine similarity on sentence embeddings (semantic fallback)
 */
import type { Tx } from '../db';
import { getEmbedModel } from '../config';
import { embedMany } from './embed';
import { log } from '../logger';
import {
  RAG_EMBED_DIMENSIONS,
  RAG_ELIGIBLE_STATUSES,
  RAG_EXAMPLE_MAX_CHARS,
  RAG_DEFAULTS,
} from './ragConstants';
import { extractNumbers, transplantNumbers, normalizeForHash } from '../utils/textNorm';

/** One retrieved example passed to the LLM. */
export type RagReferenceExample = {
  source: string;
  translation: string;
  signature: string | null;
  match_method: 'exact' | 'numeric' | 'punct_norm' | 'fuzzy' | 'embedding';
  similarity: number;
};

export type RagStats = {
  pgvectorAvailable: boolean;
  indexedCount: number;
  eligibleCount: number;
  embedModel: string;
  embedDimensions: number;
};

type RagCandidate = RagReferenceExample & {
  key: string;
};

type TranslationRow = {
  translation_id: number;
  src_string_id: number;
  src_lang: string;
  target_lang: string;
  source_text: string;
  translation_text: string;
  signature: string | null;
  path: string | null;
  context: string | null;
  game: string | null;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  status: string;
};

let pgvectorCached: boolean | null = null;

/** Whether the pgvector extension is installed (cached after first check). */
export const isPgvectorAvailable = async (db: Tx): Promise<boolean> => {
  if (pgvectorCached !== null) return pgvectorCached;
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok`,
    );
    pgvectorCached = rows[0]?.ok === true;
  } catch {
    pgvectorCached = false;
  }
  return pgvectorCached;
};

const truncate = (text: string, max = RAG_EXAMPLE_MAX_CHARS): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Build the text that is embedded for indexing and retrieval. */
export const buildEmbeddingInput = (opts: {
  sourceText: string;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
}): string => {
  const parts: string[] = [];
  if (opts.signature) parts.push(`signature: ${opts.signature}`);
  if (opts.path) parts.push(`path: ${opts.path}`);
  if (opts.context) parts.push(`context: ${opts.context}`);
  parts.push(`source: ${opts.sourceText}`);
  return parts.join(' | ');
};

const normalizeEmbedding = (vec: number[]): number[] => {
  if (vec.length === RAG_EMBED_DIMENSIONS) return vec;
  if (vec.length > RAG_EMBED_DIMENSIONS) return vec.slice(0, RAG_EMBED_DIMENSIONS);
  return [...vec, ...new Array(RAG_EMBED_DIMENSIONS - vec.length).fill(0)];
};

const vectorLiteral = (vec: number[]): string => `[${vec.join(',')}]`;

const embedTextsForRag = async (texts: string[]): Promise<number[][]> => {
  const model = getEmbedModel();
  const vectors = await embedMany(texts, model, { dimensions: RAG_EMBED_DIMENSIONS });
  return vectors.map(normalizeEmbedding);
};

const candidateKey = (source: string, translation: string): string => `${source}\0${translation}`;

const toPublicExample = (row: RagCandidate): RagReferenceExample => ({
  source: truncate(row.source),
  translation: truncate(row.translation),
  signature: row.signature,
  match_method: row.match_method,
  similarity: row.similarity,
});

const RAG_STATUS_FILTER = `t.status IN ('reviewed', 'human')`;

const fetchTmCandidates = async (
  db: Tx,
  stringId: number,
  textRaw: string,
  textNorm: string,
  textNormNopunct: string | null,
  targetLang: string,
  limit: number,
): Promise<RagCandidate[]> => {
  const results: RagCandidate[] = [];
  const seen = new Set<string>();

  const add = (
    rows: Array<{
      text: string;
      source_text: string;
      signature: string | null;
    }>,
    method: RagReferenceExample['match_method'],
    similarity: number,
  ) => {
    for (const row of rows) {
      const key = candidateKey(row.source_text, row.text);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        key,
        source: row.source_text,
        translation: row.text,
        signature: row.signature,
        match_method: method,
        similarity,
      });
    }
  };

  // Exact text_norm
  const { rows: normRows } = await db.query<{
    text: string;
    source_text: string;
    signature: string | null;
  }>(
    `SELECT DISTINCT ON (t.text)
        t.text, s.text_raw AS source_text, r.signature
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.text_norm = $1 AND s.id <> $3 AND ${RAG_STATUS_FILTER}
     ORDER BY t.text,
       CASE t.status WHEN 'reviewed' THEN 1 WHEN 'human' THEN 2 ELSE 3 END
     LIMIT $4`,
    [textNorm, targetLang, stringId, limit],
  );

  for (const row of normRows) {
    if (row.source_text === textRaw) {
      add([row], 'exact', 1.0);
    } else {
      const transplanted = transplantNumbers(
        row.text,
        extractNumbers(row.source_text),
        extractNumbers(textRaw),
      );
      if (transplanted !== null) {
        add([{ ...row, text: transplanted }], 'numeric', 0.95);
      } else {
        add([row], 'exact', 0.9);
      }
    }
  }

  if (textNormNopunct && results.length < limit) {
    const { rows: punctRows } = await db.query<{
      text: string;
      source_text: string;
      signature: string | null;
    }>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm_nopunct = $1 AND s.text_norm <> $5 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
       ORDER BY t.text,
         CASE t.status WHEN 'reviewed' THEN 1 WHEN 'human' THEN 2 ELSE 3 END
       LIMIT $4`,
      [textNormNopunct, targetLang, stringId, limit - results.length, textNorm],
    );
    add(punctRows, 'punct_norm', 0.9);
  }

  if (results.length < limit && textNorm.length >= 4) {
    const { rows: fuzzyRows } = await db.query<{
      text: string;
      source_text: string;
      signature: string | null;
      sim: number;
    }>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature,
          similarity(s.text_norm, $1)::double precision AS sim
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm % $1 AND s.text_norm <> $1 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
       ORDER BY t.text, similarity(s.text_norm, $1) DESC,
         CASE t.status WHEN 'reviewed' THEN 1 WHEN 'human' THEN 2 ELSE 3 END
       LIMIT $4`,
      [textNorm, targetLang, stringId, limit - results.length],
    );
    for (const row of fuzzyRows) {
      add(
        [{ text: row.text, source_text: row.source_text, signature: row.signature }],
        'fuzzy',
        row.sim,
      );
    }
  }

  return results;
};

const fetchEmbeddingCandidates = async (
  db: Tx,
  queryVector: number[],
  srcLang: string,
  targetLang: string,
  excludeStringId: number,
  limit: number,
  minSimilarity: number,
): Promise<RagCandidate[]> => {
  const literal = vectorLiteral(queryVector);
  const { rows } = await db.query<{
    source_text: string;
    translation_text: string;
    signature: string | null;
    similarity: number;
  }>(
    `SELECT te.source_text, te.translation_text, te.signature,
            (1 - (te.embedding <=> $1::vector))::double precision AS similarity
     FROM translation_examples te
     WHERE te.src_lang = $2 AND te.target_lang = $3
       AND te.src_string_id <> $4
       AND (1 - (te.embedding <=> $1::vector)) >= $5
     ORDER BY te.embedding <=> $1::vector
     LIMIT $6`,
    [literal, srcLang, targetLang, excludeStringId, minSimilarity, limit],
  );

  return rows.map((row) => ({
    key: candidateKey(row.source_text, row.translation_text),
    source: row.source_text,
    translation: row.translation_text,
    signature: row.signature,
    match_method: 'embedding' as const,
    similarity: row.similarity,
  }));
};

const rankCandidates = (candidates: RagCandidate[]): RagCandidate[] => {
  const methodWeight: Record<RagReferenceExample['match_method'], number> = {
    exact: 1.0,
    numeric: 0.92,
    punct_norm: 0.85,
    fuzzy: 0.7,
    embedding: 0.65,
  };

  return [...candidates].sort((a, b) => {
    const scoreA = (methodWeight[a.match_method] ?? 0.5) * a.similarity;
    const scoreB = (methodWeight[b.match_method] ?? 0.5) * b.similarity;
    return scoreB - scoreA;
  });
};

const loadTranslationRow = async (
  db: Tx,
  translationId: number,
): Promise<TranslationRow | null> => {
  const { rows } = await db.query<TranslationRow>(
    `SELECT t.id AS translation_id, t.src_string_id, s.lang AS src_lang,
            t.target_lang, s.text_raw AS source_text, t.text AS translation_text,
            r.signature, r.path, s.context, m.game, s.text_norm, s.text_norm_nopunct,
            t.status
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id
     JOIN records r ON r.id = s.record_id
     JOIN mods m ON m.id = r.mod_id
     WHERE t.id = $1`,
    [translationId],
  );
  return rows[0] ?? null;
};

/**
 * Upsert or remove a translation in the RAG index based on its current status.
 */
export const syncTranslationExample = async (db: Tx, translationId: number): Promise<void> => {
  const row = await loadTranslationRow(db, translationId);
  if (!row) return;

  if (!RAG_ELIGIBLE_STATUSES.includes(row.status as 'reviewed' | 'human')) {
    await db.query(`DELETE FROM translation_examples WHERE translation_id = $1`, [translationId]);
    return;
  }

  if (!(await isPgvectorAvailable(db))) {
    log.warn('RAG sync skipped: pgvector extension is not available');
    return;
  }

  const embedInput = buildEmbeddingInput({
    sourceText: row.source_text,
    signature: row.signature,
    path: row.path,
    context: row.context,
  });
  const [embedding] = await embedTextsForRag([embedInput]);
  const model = getEmbedModel();
  const literal = vectorLiteral(embedding);

  await db.query(
    `INSERT INTO translation_examples(
       translation_id, src_string_id, src_lang, target_lang,
       source_text, translation_text, signature, path, game,
       embed_model, embedding, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, NOW())
     ON CONFLICT (translation_id) DO UPDATE SET
       src_string_id = EXCLUDED.src_string_id,
       src_lang = EXCLUDED.src_lang,
       target_lang = EXCLUDED.target_lang,
       source_text = EXCLUDED.source_text,
       translation_text = EXCLUDED.translation_text,
       signature = EXCLUDED.signature,
       path = EXCLUDED.path,
       game = EXCLUDED.game,
       embed_model = EXCLUDED.embed_model,
       embedding = EXCLUDED.embedding,
       updated_at = NOW()`,
    [
      translationId,
      row.src_string_id,
      row.src_lang,
      row.target_lang,
      row.source_text,
      row.translation_text,
      row.signature,
      row.path,
      row.game,
      model,
      literal,
    ],
  );
};

export type FindReferenceExamplesOpts = {
  stringId: number;
  sourceText: string;
  textNorm?: string | null;
  textNormNopunct?: string | null;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
  srcLang: string;
  targetLang: string;
  maxExamples?: number;
  minSimilarity?: number;
};

/**
 * Hybrid retrieval: TM candidates first, then embedding similarity.
 */
export const findReferenceExamples = async (
  db: Tx,
  opts: FindReferenceExamplesOpts,
): Promise<RagReferenceExample[]> => {
  const maxExamples = opts.maxExamples ?? RAG_DEFAULTS.maxExamples;
  const minSimilarity = opts.minSimilarity ?? RAG_DEFAULTS.minSimilarity;
  const textNorm = opts.textNorm ?? normalizeForHash(opts.sourceText);
  const textNormNopunct = opts.textNormNopunct ?? null;

  const tmCandidates = await fetchTmCandidates(
    db,
    opts.stringId,
    opts.sourceText,
    textNorm,
    textNormNopunct,
    opts.targetLang,
    maxExamples * 2,
  );

  const merged = new Map<string, RagCandidate>();
  for (const c of tmCandidates) merged.set(c.key, c);

  if (merged.size < maxExamples && (await isPgvectorAvailable(db))) {
    try {
      const embedInput = buildEmbeddingInput({
        sourceText: opts.sourceText,
        signature: opts.signature,
        path: opts.path,
        context: opts.context,
      });
      const [queryVec] = await embedTextsForRag([embedInput]);
      const embedCandidates = await fetchEmbeddingCandidates(
        db,
        queryVec,
        opts.srcLang,
        opts.targetLang,
        opts.stringId,
        maxExamples * 2,
        minSimilarity,
      );
      for (const c of embedCandidates) {
        if (!merged.has(c.key)) merged.set(c.key, c);
      }
    } catch (err) {
      log.warn({ err, stringId: opts.stringId }, 'RAG embedding retrieval failed, using TM only');
    }
  }

  return rankCandidates([...merged.values()])
    .slice(0, maxExamples)
    .map(toPublicExample);
};

export type FetchReferenceExamplesBatchItem = {
  stringId: number;
  sourceText: string;
  textNorm?: string | null;
  textNormNopunct?: string | null;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
};

/**
 * Fetch reference examples for a batch of strings (parallel per item).
 */
export const fetchReferenceExamplesBatch = async (
  db: Tx,
  items: FetchReferenceExamplesBatchItem[],
  srcLang: string,
  targetLang: string,
  maxExamples: number,
  minSimilarity: number,
): Promise<Map<number, RagReferenceExample[]>> => {
  const out = new Map<number, RagReferenceExample[]>();
  await Promise.all(
    items.map(async (item) => {
      const examples = await findReferenceExamples(db, {
        ...item,
        srcLang,
        targetLang,
        maxExamples,
        minSimilarity,
      });
      out.set(item.stringId, examples);
    }),
  );
  return out;
};

export type ReindexResult = {
  indexed: number;
  skipped: number;
  failed: number;
  total: number;
};

/** Rebuild the full RAG index from all eligible translations. */
export const reindexAllTranslationExamples = async (
  db: Tx,
  onProgress?: (done: number, total: number) => void,
): Promise<ReindexResult> => {
  if (!(await isPgvectorAvailable(db))) {
    throw new Error('pgvector extension is not available — cannot reindex RAG examples');
  }

  const { rows } = await db.query<{ id: number }>(
    `SELECT t.id FROM translations t
     WHERE t.status IN ('reviewed', 'human')
     ORDER BY t.id`,
  );

  const total = rows.length;
  let indexed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const id = rows[i].id;
    try {
      await syncTranslationExample(db, id);
      indexed++;
    } catch (err) {
      log.error({ err, translationId: id }, 'RAG reindex failed for translation');
      failed++;
    }
    if (onProgress) onProgress(i + 1, total);
  }

  // Remove stale rows whose translation is no longer eligible
  const { rowCount } = await db.query(
    `DELETE FROM translation_examples te
     WHERE NOT EXISTS (
       SELECT 1 FROM translations t
       WHERE t.id = te.translation_id AND t.status IN ('reviewed', 'human')
     )`,
  );
  const removed = rowCount ?? 0;

  return { indexed, skipped: removed, failed, total };
};

/** Aggregate RAG index statistics for the ops dashboard. */
export const getRagStats = async (db: Tx): Promise<RagStats> => {
  const pgvectorAvailable = await isPgvectorAvailable(db);
  const { rows: countRows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM translation_examples`,
  );
  const { rows: eligibleRows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM translations WHERE status IN ('reviewed', 'human')`,
  );

  return {
    pgvectorAvailable,
    indexedCount: countRows[0]?.count ?? 0,
    eligibleCount: eligibleRows[0]?.count ?? 0,
    embedModel: getEmbedModel(),
    embedDimensions: RAG_EMBED_DIMENSIONS,
  };
};
