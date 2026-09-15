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

export type GlossarySelectDeps = {
  embedTexts?: (texts: string[]) => Promise<number[][]>;
};

type CachedTermVecs = {
  entries: LlmGlossaryEntry[];
  vectors: number[][];
};

const termVecCache = new Map<string, CachedTermVecs>();

const cacheKey = (entries: readonly LlmGlossaryEntry[]): string =>
  entries.map((entry) => `${entry.term}\t${entry.translation ?? ''}`).join('\n');

/** Test helper — drop cached term vectors. */
export const resetGlossaryEmbedCache = (): void => {
  termVecCache.clear();
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

const loadTermVectors = async (
  glossary: readonly LlmGlossaryEntry[],
  embedTexts: (texts: string[]) => Promise<number[][]>,
): Promise<CachedTermVecs> => {
  const key = cacheKey(glossary);
  const cached = termVecCache.get(key);
  if (cached) return cached;
  const entries = glossary
    .filter((entry) => entry.term.trim() !== '')
    .map((entry) => ({ term: entry.term, translation: entry.translation }));
  const vectors = await embedTexts(entries.map((entry) => entry.term));
  const next = { entries, vectors };
  termVecCache.set(key, next);
  return next;
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
 * Embedding failure falls back to word-boundary only.
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
    const cached = await loadTermVectors(glossary, embedTexts);
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
