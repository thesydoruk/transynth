/**
 * Translation RAG — indexes reviewed translations and retrieves
 * similar examples as few-shot context for LLM translation.
 *
 * Retrieval is hybrid:
 * 1. TM-style trigram / text_norm matches (cheap, PostgreSQL pg_trgm)
 * 2. pgvector cosine similarity on sentence embeddings (semantic fallback)
 */
import type { Tx } from '../db';
import { CONFIG, getEmbedModel } from '../config';
import { embedMany } from './embed';
import { mapWithConcurrency } from '../utils/concurrency';
import { logRag } from '../logging/loggers';
import {
  RAG_EMBED_DIMENSIONS,
  RAG_ELIGIBLE_STATUSES,
  RAG_ELIGIBLE_STATUSES_SQL,
  RAG_EXAMPLE_MAX_CHARS,
  RAG_DEFAULTS,
  clampRagMaxExamples,
  type RagEligibleStatus,
} from './ragConstants';
import { extractNumbers, transplantNumbers, normalizeForHash } from '../utils/textNorm';
import { parseRecordLocation } from '../utils/recordLocation';

/** One retrieved example passed to the LLM. */
export type RagReferenceExample = {
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
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

type RagCandidate = {
  key: string;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  match_method: RagReferenceExample['match_method'];
  similarity: number;
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

/** Throws when pgvector is missing — LLM auto-translation requires RAG vector search. */
export const requirePgvectorForRag = async (db: Tx): Promise<void> => {
  if (!(await isPgvectorAvailable(db))) {
    logRag.error('pgvector extension is not available — LLM translation requires RAG');
    throw new Error(
      'pgvector extension is not available — LLM translation requires RAG with vector search',
    );
  }
  logRag.debug('pgvector available');
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
  const vectors = await embedMany(texts, model, {
    dimensions: RAG_EMBED_DIMENSIONS,
    logMeta: {
      operation: 'rag_embed',
      context: { textCount: texts.length },
    },
  });
  return vectors.map(normalizeEmbedding);
};

const isEmbedPayloadTooLarge = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b413\b/.test(msg) || msg.toLowerCase().includes('payload too large');
};

/** Split embed batches on HTTP 413 until the server accepts the payload. */
const embedTextsForRagResilient = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];
  try {
    return await embedTextsForRag(texts);
  } catch (err) {
    if (!isEmbedPayloadTooLarge(err) || texts.length <= 1) throw err;
    const mid = Math.ceil(texts.length / 2);
    logRag.debug('rag_embed split after 413', {
      from: texts.length,
      left: mid,
      right: texts.length - mid,
    });
    const left = await embedTextsForRagResilient(texts.slice(0, mid));
    const right = await embedTextsForRagResilient(texts.slice(mid));
    return [...left, ...right];
  }
};

const finalizePendingEmbedRow = (
  row: { stringId: number; merged: Map<string, RagCandidate> },
  cappedMaxExamples: number,
  out: Map<number, RagReferenceExample[]>,
): void => {
  out.set(
    row.stringId,
    rankCandidates([...row.merged.values()])
      .slice(0, cappedMaxExamples)
      .map(toPublicExample),
  );
};

const candidateKey = (source: string, translation: string): string => `${source}\0${translation}`;

const toPublicExample = (row: RagCandidate): RagReferenceExample => {
  const { grup, field } = parseRecordLocation(row.signature, row.path);
  return {
    source: truncate(row.source),
    translation: truncate(row.translation),
    grup,
    edid: row.edid,
    field,
    match_method: row.match_method,
    similarity: row.similarity,
  };
};

const RAG_STATUS_FILTER = `t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})`;

type TmMatchRow = {
  text: string;
  source_text: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
};

const addTmCandidates = (
  merged: Map<string, RagCandidate>,
  rows: TmMatchRow[],
  method: RagReferenceExample['match_method'],
  similarity: number,
  limit: number,
): void => {
  for (const row of rows) {
    if (merged.size >= limit) return;
    const key = candidateKey(row.source_text, row.text);
    if (merged.has(key)) continue;
    merged.set(key, {
      key,
      source: row.source_text,
      translation: row.text,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      match_method: method,
      similarity,
    });
  }
};

const addExactNormCandidates = (
  merged: Map<string, RagCandidate>,
  queryRaw: string,
  rows: TmMatchRow[],
  limit: number,
): void => {
  for (const row of rows) {
    if (merged.size >= limit) return;
    if (row.source_text === queryRaw) {
      addTmCandidates(merged, [row], 'exact', 1.0, limit);
    } else {
      const transplanted = transplantNumbers(
        row.text,
        extractNumbers(row.source_text),
        extractNumbers(queryRaw),
      );
      if (transplanted !== null) {
        addTmCandidates(merged, [{ ...row, text: transplanted }], 'numeric', 0.95, limit);
      } else {
        addTmCandidates(merged, [row], 'exact', 0.9, limit);
      }
    }
  }
};

const groupBulkTmRows = <T extends { query_id: number }>(rows: T[]): Map<number, T[]> => {
  const byId = new Map<number, T[]>();
  for (const row of rows) {
    const list = byId.get(row.query_id);
    if (list) list.push(row);
    else byId.set(row.query_id, [row]);
  }
  return byId;
};

/** Two SQL round trips for TM exact + punct_norm (batch prefetch — no per-row fuzzy trigram). */
const fetchTmCandidatesBulk = async (
  db: Tx,
  items: Array<{
    stringId: number;
    sourceText: string;
    textNorm: string;
    textNormNopunct: string | null;
  }>,
  targetLang: string,
  srcLang: string,
  limitPerItem: number,
): Promise<Map<number, Map<string, RagCandidate>>> => {
  const byId = new Map<number, Map<string, RagCandidate>>();
  for (const item of items) byId.set(item.stringId, new Map());
  if (items.length === 0) return byId;

  type BulkTmDbRow = TmMatchRow & { query_id: number; query_raw: string };

  const { rows: exactRows } = await db.query<BulkTmDbRow>(
    `WITH batch AS (
       SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[]) AS b(query_id, query_raw, text_norm)
     )
     SELECT b.query_id, b.query_raw,
            t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
     FROM batch b
     JOIN strings s ON s.text_norm = b.text_norm AND s.id <> b.query_id AND s.lang = $5
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $4
     WHERE ${RAG_STATUS_FILTER}`,
    [
      items.map((i) => i.stringId),
      items.map((i) => i.sourceText),
      items.map((i) => i.textNorm),
      targetLang,
      srcLang,
    ],
  );

  for (const [queryId, rows] of groupBulkTmRows(exactRows)) {
    const item = items.find((i) => i.stringId === queryId);
    if (!item) continue;
    addExactNormCandidates(byId.get(queryId)!, item.sourceText, rows, limitPerItem);
  }

  const punctItems = items.filter((item) => {
    const merged = byId.get(item.stringId);
    return (
      merged &&
      merged.size < limitPerItem &&
      item.textNormNopunct != null &&
      item.textNormNopunct !== ''
    );
  });

  if (punctItems.length > 0) {
    const { rows: punctRows } = await db.query<BulkTmDbRow>(
      `WITH batch AS (
         SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[]) AS b(
           query_id, query_raw, text_norm, text_norm_nopunct
         )
       )
       SELECT b.query_id, b.query_raw,
              t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
       FROM batch b
       JOIN strings s
         ON s.text_norm_nopunct = b.text_norm_nopunct
        AND s.text_norm <> b.text_norm
        AND s.id <> b.query_id
        AND s.lang = $6
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $5
       WHERE ${RAG_STATUS_FILTER}`,
      [
        punctItems.map((i) => i.stringId),
        punctItems.map((i) => i.sourceText),
        punctItems.map((i) => i.textNorm),
        punctItems.map((i) => i.textNormNopunct!),
        targetLang,
        srcLang,
      ],
    );

    for (const [queryId, rows] of groupBulkTmRows(punctRows)) {
      addTmCandidates(byId.get(queryId)!, rows, 'punct_norm', 0.9, limitPerItem);
    }
  }

  return byId;
};

const fetchTmCandidates = async (
  db: Tx,
  stringId: number,
  textRaw: string,
  textNorm: string,
  textNormNopunct: string | null,
  targetLang: string,
  limit: number,
): Promise<RagCandidate[]> => {
  const merged = new Map<string, RagCandidate>();
  const limitPerQuery = limit;

  const { rows: normRows } = await db.query<TmMatchRow>(
    `SELECT DISTINCT ON (t.text)
        t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.text_norm = $1 AND s.id <> $3 AND ${RAG_STATUS_FILTER}
     ORDER BY t.text
     LIMIT $4`,
    [textNorm, targetLang, stringId, limitPerQuery],
  );

  addExactNormCandidates(merged, textRaw, normRows, limitPerQuery);

  if (textNormNopunct && merged.size < limitPerQuery) {
    const { rows: punctRows } = await db.query<TmMatchRow>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm_nopunct = $1 AND s.text_norm <> $5 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
       ORDER BY t.text
       LIMIT $4`,
      [textNormNopunct, targetLang, stringId, limitPerQuery - merged.size, textNorm],
    );
    addTmCandidates(merged, punctRows, 'punct_norm', 0.9, limitPerQuery);
  }

  if (merged.size < limitPerQuery && textNorm.length >= 4) {
    const { rows: fuzzyRows } = await db.query<TmMatchRow & { sim: number }>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature, r.path, r.edid,
          similarity(s.text_norm, $1)::double precision AS sim
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm % $1 AND s.text_norm <> $1 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
       ORDER BY t.text, similarity(s.text_norm, $1) DESC
       LIMIT $4`,
      [textNorm, targetLang, stringId, limitPerQuery - merged.size],
    );
    for (const row of fuzzyRows) {
      addTmCandidates(
        merged,
        [
          {
            text: row.text,
            source_text: row.source_text,
            signature: row.signature,
            path: row.path,
            edid: row.edid,
          },
        ],
        'fuzzy',
        row.sim,
        limitPerQuery,
      );
    }
  }

  return [...merged.values()];
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
    path: string | null;
    edid: string | null;
    similarity: number;
  }>(
    `SELECT te.source_text, te.translation_text, te.signature, te.path, r.edid,
            (1 - (te.embedding <=> $1::vector))::double precision AS similarity
     FROM translation_examples te
     JOIN translations t ON t.id = te.translation_id
     JOIN strings s ON s.id = te.src_string_id
     JOIN records r ON r.id = s.record_id
     WHERE te.src_lang = $2 AND te.target_lang = $3
       AND te.src_string_id <> $4
       AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
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
    path: row.path,
    edid: row.edid,
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

/** True when a concurrent delete/replace removed the translation before index upsert. */
export const isStaleTranslationRagSyncError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'code' in err &&
  (err as { code: string }).code === '23503';

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

  if (!RAG_ELIGIBLE_STATUSES.includes(row.status as RagEligibleStatus)) {
    await db.query(`DELETE FROM translation_examples WHERE translation_id = $1`, [translationId]);
    return;
  }

  if (!(await isPgvectorAvailable(db))) {
    logRag.warn('RAG sync skipped: pgvector extension is not available', { translationId });
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

  // Embedding is slow; bulk upserts (e.g. mod import) may delete/replace this row meanwhile.
  const current = await loadTranslationRow(db, translationId);
  if (!current || !RAG_ELIGIBLE_STATUSES.includes(current.status as RagEligibleStatus)) {
    await db.query(`DELETE FROM translation_examples WHERE translation_id = $1`, [translationId]);
    return;
  }

  try {
    await db.query(
      `INSERT INTO translation_examples(
         translation_id, src_string_id, src_lang, target_lang,
         source_text, translation_text, signature, path, game,
         embed_model, embedding, updated_at
       )
       SELECT t.id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::vector, NOW()
       FROM translations t
       WHERE t.id = $1 AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
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
        current.src_string_id,
        current.src_lang,
        current.target_lang,
        current.source_text,
        current.translation_text,
        current.signature,
        current.path,
        current.game,
        model,
        literal,
      ],
    );
  } catch (err) {
    if (isStaleTranslationRagSyncError(err)) return;
    throw err;
  }
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
  await requirePgvectorForRag(db);

  const maxExamples = clampRagMaxExamples(opts.maxExamples);
  const minSimilarity = opts.minSimilarity ?? RAG_DEFAULTS.minSimilarity;
  const textNorm = opts.textNorm ?? normalizeForHash(opts.sourceText);
  const textNormNopunct = opts.textNormNopunct ?? null;

  logRag.debug('findReferenceExamples start', {
    stringId: opts.stringId,
    maxExamples,
    minSimilarity,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
  });

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

  if (merged.size < maxExamples) {
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
  }

  const examples = rankCandidates([...merged.values()])
    .slice(0, maxExamples)
    .map(toPublicExample);

  logRag.debug('findReferenceExamples done', {
    stringId: opts.stringId,
    tmCount: tmCandidates.length,
    mergedCount: merged.size,
    returned: examples.length,
    methods: examples.map((e) => e.match_method),
  });

  return examples;
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
 * Fetch reference examples for a batch of strings.
 *
 * TM: two bulk SQL queries (exact + punct_norm). Embedding: parallel HTTP batches
 * sized by {@link CONFIG.ragEmbedBatchSize} and {@link CONFIG.embedMaxParallel}.
 */
export const fetchReferenceExamplesBatch = async (
  db: Tx,
  items: FetchReferenceExamplesBatchItem[],
  srcLang: string,
  targetLang: string,
  maxExamples: number,
  minSimilarity: number,
): Promise<Map<number, RagReferenceExample[]>> => {
  await requirePgvectorForRag(db);

  const cappedMaxExamples = clampRagMaxExamples(maxExamples);
  const tmLimit = cappedMaxExamples * 2;
  const started = Date.now();

  logRag.debug('fetchReferenceExamplesBatch start', {
    itemCount: items.length,
    maxExamples: cappedMaxExamples,
    minSimilarity,
    srcLang,
    targetLang,
  });

  const out = new Map<number, RagReferenceExample[]>();
  if (items.length === 0) return out;

  type PendingEmbed = {
    stringId: number;
    merged: Map<string, RagCandidate>;
    embedInput: string;
  };

  const pendingEmbed: PendingEmbed[] = [];

  const normalizedItems = items.map((item) => ({
    stringId: item.stringId,
    sourceText: item.sourceText,
    textNorm: item.textNorm ?? normalizeForHash(item.sourceText),
    textNormNopunct: item.textNormNopunct ?? null,
    signature: item.signature,
    path: item.path,
    context: item.context,
  }));

  const tmStarted = Date.now();
  const tmById = await fetchTmCandidatesBulk(db, normalizedItems, targetLang, srcLang, tmLimit);
  const tmMs = Date.now() - tmStarted;

  for (const item of normalizedItems) {
    const merged = tmById.get(item.stringId) ?? new Map<string, RagCandidate>();
    if (merged.size < cappedMaxExamples) {
      pendingEmbed.push({
        stringId: item.stringId,
        merged,
        embedInput: buildEmbeddingInput({
          sourceText: item.sourceText,
          signature: item.signature,
          path: item.path,
          context: item.context,
        }),
      });
      continue;
    }
    out.set(
      item.stringId,
      rankCandidates([...merged.values()])
        .slice(0, cappedMaxExamples)
        .map(toPublicExample),
    );
  }

  if (pendingEmbed.length > 0) {
    const embedBatchSize = CONFIG.ragEmbedBatchSize;
    const embedSlices: PendingEmbed[][] = [];
    for (let offset = 0; offset < pendingEmbed.length; offset += embedBatchSize) {
      embedSlices.push(pendingEmbed.slice(offset, offset + embedBatchSize));
    }

    const vectorConcurrency = Math.max(
      2,
      Math.min(8, Math.floor((CONFIG.dbPoolMax - 4) / Math.max(1, CONFIG.embedMaxParallel))),
    );

    const embedStarted = Date.now();
    logRag.debug('batch embedding retrieval', {
      pendingCount: pendingEmbed.length,
      embedSlices: embedSlices.length,
      embedBatchSize,
      embedMaxParallel: CONFIG.embedMaxParallel,
    });

    const processEmbedSlice = async (slice: PendingEmbed[]): Promise<void> => {
      try {
        const vectors = await embedTextsForRagResilient(slice.map((row) => row.embedInput));
        await mapWithConcurrency(slice, vectorConcurrency, async (row, index) => {
          const embedCandidates = await fetchEmbeddingCandidates(
            db,
            vectors[index]!,
            srcLang,
            targetLang,
            row.stringId,
            tmLimit,
            minSimilarity,
          );
          for (const c of embedCandidates) {
            if (!row.merged.has(c.key)) row.merged.set(c.key, c);
          }
          finalizePendingEmbedRow(row, cappedMaxExamples, out);
        });
      } catch (err) {
        logRag.warn('rag_embed slice failed; keeping TM-only examples', {
          err: err instanceof Error ? err.message : String(err),
          sliceSize: slice.length,
        });
        for (const row of slice) {
          finalizePendingEmbedRow(row, cappedMaxExamples, out);
        }
      }
    };

    await mapWithConcurrency(embedSlices, CONFIG.embedMaxParallel, processEmbedSlice);
    const embedMs = Date.now() - embedStarted;

    if (items.length >= 50) {
      logRag.info('fetchReferenceExamplesBatch timing', {
        itemCount: items.length,
        tmOnly: pendingEmbed.length === 0,
        embedPending: pendingEmbed.length,
        tmMs,
        embedMs,
        totalMs: Date.now() - started,
      });
    }
  } else if (items.length >= 50) {
    logRag.info('fetchReferenceExamplesBatch timing', {
      itemCount: items.length,
      tmOnly: true,
      tmMs,
      totalMs: Date.now() - started,
    });
  }

  logRag.debug('fetchReferenceExamplesBatch done', {
    itemCount: items.length,
    embedQueries: pendingEmbed.length,
    withExamples: [...out.values()].filter((rows) => rows.length > 0).length,
  });

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
     WHERE t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
     ORDER BY t.id`,
  );

  const total = rows.length;
  let indexed = 0;
  let failed = 0;
  let progressDone = 0;

  await mapWithConcurrency(rows, CONFIG.embedMaxParallel, async (row) => {
    try {
      await syncTranslationExample(db, row.id);
      indexed++;
    } catch (err) {
      logRag.error('RAG reindex failed for translation', { err, translationId: row.id });
      failed++;
    }
    progressDone++;
    onProgress?.(progressDone, total);
  });

  // Remove stale rows whose translation is no longer eligible
  const { rowCount } = await db.query(
    `DELETE FROM translation_examples te
     WHERE NOT EXISTS (
       SELECT 1 FROM translations t
       WHERE t.id = te.translation_id AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
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
    `SELECT COUNT(*)::int AS count FROM translations WHERE status IN (${RAG_ELIGIBLE_STATUSES_SQL})`,
  );

  return {
    pgvectorAvailable,
    indexedCount: countRows[0]?.count ?? 0,
    eligibleCount: eligibleRows[0]?.count ?? 0,
    embedModel: getEmbedModel(),
    embedDimensions: RAG_EMBED_DIMENSIONS,
  };
};
