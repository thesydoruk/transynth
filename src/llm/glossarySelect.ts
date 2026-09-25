/**
 * Pick glossary rows for one LLM request.
 *
 * Word-boundary hits are required (Pip-Boy must appear when the source says
 * Pip-Boy). Embedding fill adds a few nearby canon terms the regex missed.
 * The full glossary never goes into the system prompt.
 */
import { cosine, embedMany } from './embed';
import { getEmbedModel } from '../config';
import { logLlm } from '../logging/loggers';
import { glossaryTermMatchesSource } from '../web/data/queries/glossaryHelpers';
import type { LlmGlossaryEntry } from './translate';

const GLOSSARY_PROMPT_LIMIT = 24;
const GLOSSARY_EMBED_FILL_MAX = 8;
export const GLOSSARY_EMBED_MIN_SIM = 0.5;
const QUERY_EMBED_MAX_CHARS = 2_000;

/**
 * Terms per embedding request when a glossary's vectors are first built.
 *
 * A game glossary runs to two thousand terms. Sent as one request they were
 * refused with HTTP 413, and because a failure was never remembered, every
 * chunk of every job asked again: 54,558 refusals in three days of logs on the
 * production host, one wasted round trip per LLM batch, and the embedding fill
 * this exists to provide never once ran. Terms are short, so the batch is
 * larger than the RAG one; a 413 still halves it until the server accepts.
 */
export const GLOSSARY_TERM_EMBED_BATCH = 64;

/** How long a failed glossary embedding is remembered before it is retried. */
export const GLOSSARY_EMBED_RETRY_AFTER_MS = 10 * 60 * 1000;

export type GlossarySelectDeps = {
  embedTexts?: (texts: string[]) => Promise<number[][]>;
  /** Clock for the failure memory; tests inject one. */
  now?: () => number;
};

type CachedTermVecs = {
  entries: LlmGlossaryEntry[];
  vectors: number[][];
};

/**
 * One entry per glossary: the vectors, the build still in flight — so twenty
 * concurrent chunks share one build instead of each embedding the same two
 * thousand terms — or the moment the last build failed.
 */
type TermVecCacheEntry =
  | { kind: 'ready'; vectors: CachedTermVecs }
  | { kind: 'pending'; promise: Promise<CachedTermVecs> }
  | { kind: 'failed'; at: number; error: string };

const termVecCache = new Map<string, TermVecCacheEntry>();

const cacheKey = (entries: readonly LlmGlossaryEntry[]): string =>
  entries.map((entry) => `${entry.term}\t${entry.translation ?? ''}`).join('\n');

/** Test helper — drop cached term vectors. */
export const resetGlossaryEmbedCache = (): void => {
  termVecCache.clear();
};

const isPayloadTooLarge = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b413\b/.test(msg) || msg.toLowerCase().includes('payload too large');
};

/** Embed in batches; halve a batch the server refuses as too large. */
export const embedTermsInBatches = async (
  texts: readonly string[],
  embedTexts: (texts: string[]) => Promise<number[][]>,
  batchSize = GLOSSARY_TERM_EMBED_BATCH,
): Promise<number[][]> => {
  const embedSlice = async (slice: string[]): Promise<number[][]> => {
    try {
      return await embedTexts(slice);
    } catch (err) {
      if (!isPayloadTooLarge(err) || slice.length <= 1) throw err;
      const mid = Math.ceil(slice.length / 2);
      return [...(await embedSlice(slice.slice(0, mid))), ...(await embedSlice(slice.slice(mid)))];
    }
  };

  const out: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += batchSize) {
    out.push(...(await embedSlice(texts.slice(offset, offset + batchSize))));
  }
  return out;
};

export const selectGlossaryByWordBoundary = (
  glossary: readonly LlmGlossaryEntry[],
  sourceTexts: readonly string[],
  limit = GLOSSARY_PROMPT_LIMIT,
): LlmGlossaryEntry[] => {
  if (glossary.length === 0 || sourceTexts.length === 0 || limit <= 0) return [];
  const out: LlmGlossaryEntry[] = [];
  for (const entry of glossary) {
    if (!entry.term.trim()) continue;
    if (sourceTexts.some((text) => glossaryTermMatchesSource(text, entry.term))) {
      out.push({ term: entry.term, translation: entry.translation });
      if (out.length >= limit) break;
    }
  }
  return out;
};

const defaultEmbed = async (texts: string[]): Promise<number[][]> =>
  embedMany(texts, getEmbedModel(), {
    logMeta: { operation: 'glossary_embed', context: { textCount: texts.length } },
  });

const buildTermVectors = async (
  glossary: readonly LlmGlossaryEntry[],
  embedTexts: (texts: string[]) => Promise<number[][]>,
): Promise<CachedTermVecs> => {
  const entries = glossary
    .filter((entry) => entry.term.trim() !== '')
    .map((entry) => ({ term: entry.term, translation: entry.translation }));
  const vectors = await embedTermsInBatches(
    entries.map((entry) => entry.term),
    embedTexts,
  );
  return { entries, vectors };
};

/**
 * Vectors for a glossary, built once per process and shared by every chunk.
 *
 * @throws When the build failed recently — the error is replayed without a
 * request, so the fallback is immediate until the retry window has passed.
 */
const loadTermVectors = async (
  glossary: readonly LlmGlossaryEntry[],
  embedTexts: (texts: string[]) => Promise<number[][]>,
  now: () => number,
): Promise<CachedTermVecs> => {
  const key = cacheKey(glossary);
  const cached = termVecCache.get(key);
  if (cached?.kind === 'ready') return cached.vectors;
  if (cached?.kind === 'pending') return cached.promise;
  if (cached?.kind === 'failed' && now() - cached.at < GLOSSARY_EMBED_RETRY_AFTER_MS) {
    throw new Error(`glossary embedding failed recently: ${cached.error}`);
  }

  const promise = buildTermVectors(glossary, embedTexts).then(
    (vectors) => {
      termVecCache.set(key, { kind: 'ready', vectors });
      return vectors;
    },
    (err: unknown) => {
      termVecCache.set(key, {
        kind: 'failed',
        at: now(),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    },
  );
  termVecCache.set(key, { kind: 'pending', promise });
  return promise;
};

const selectGlossaryByEmbedding = (
  queryVec: number[],
  cached: CachedTermVecs,
  used: Set<string>,
  fill: number,
): LlmGlossaryEntry[] => {
  if (fill <= 0) return [];
  const ranked = cached.entries
    .map((entry, index) => ({
      entry,
      sim: cosine(queryVec, cached.vectors[index] ?? []),
    }))
    .filter((row) => !used.has(row.entry.term.toLowerCase()) && row.sim >= GLOSSARY_EMBED_MIN_SIM)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, fill);
  return ranked.map((row) => row.entry);
};

/**
 * Glossary for one chunk: exact source hits first, then embedding neighbors.
 * Embedding failure falls back to word-boundary only, and is remembered rather
 * than retried on every chunk: see {@link GLOSSARY_EMBED_RETRY_AFTER_MS}.
 */
export const selectRelevantGlossary = async (
  glossary: readonly LlmGlossaryEntry[],
  sourceTexts: readonly string[],
  deps: GlossarySelectDeps = {},
): Promise<LlmGlossaryEntry[]> => {
  const hits = selectGlossaryByWordBoundary(glossary, sourceTexts, GLOSSARY_PROMPT_LIMIT);
  if (hits.length >= GLOSSARY_PROMPT_LIMIT || glossary.length === 0) return hits;

  const query = sourceTexts.join('\n').trim().slice(0, QUERY_EMBED_MAX_CHARS);
  if (!query) return hits;

  try {
    const embedTexts = deps.embedTexts ?? defaultEmbed;
    const cached = await loadTermVectors(glossary, embedTexts, deps.now ?? Date.now);
    const [queryVec] = await embedTexts([query]);
    if (!queryVec) return hits;
    const used = new Set(hits.map((entry) => entry.term.toLowerCase()));
    const fill = Math.min(GLOSSARY_EMBED_FILL_MAX, GLOSSARY_PROMPT_LIMIT - hits.length);
    return [...hits, ...selectGlossaryByEmbedding(queryVec, cached, used, fill)];
  } catch (err) {
    logLlm.warn('glossary embed filter failed; using word-boundary hits only', {
      err: err instanceof Error ? err.message : String(err),
      hitCount: hits.length,
    });
    return hits;
  }
};
