/**
 * LLM Translation Cache Service.
 *
 * Provides lookup and store operations for the `translation_cache` table.
 * The cache key is `(text_norm, src_lang, tgt_lang, model)` — when the same
 * normalised source text is requested for the same language pair and model,
 * the cached translation is returned instantly without hitting the LLM.
 */

import type { Tx } from '../db';
import { normalizeForHash } from '../utils/textNorm';

/** Result of a cache lookup — null when miss */
export interface CacheHit {
  translated: string;
}

/**
 * Look up a previously cached LLM translation.
 *
 * @param db    - Database connection / transaction handle
 * @param raw   - Raw (un-normalised) source text
 * @param srcLang - Source language code (e.g. 'en')
 * @param tgtLang - Target language code (e.g. 'uk')
 * @param model   - LLM model identifier used for translation
 * @returns The cached translation text or null on cache miss
 */
export async function cacheLookup(
  db: Tx,
  raw: string,
  srcLang: string,
  tgtLang: string,
  model: string,
): Promise<CacheHit | null> {
  const norm = normalizeForHash(raw);
  const { rows } = await db.query<{ translated: string }>(
    `SELECT translated FROM translation_cache
     WHERE text_norm = $1 AND src_lang = $2 AND tgt_lang = $3 AND model = $4
     LIMIT 1`,
    [norm, srcLang, tgtLang, model],
  );
  return rows[0] ? { translated: rows[0].translated } : null;
}

/**
 * Store an LLM translation result in the cache.
 *
 * Uses INSERT … ON CONFLICT to avoid duplicates when concurrent requests
 * translate the same text simultaneously.
 *
 * @param db       - Database connection / transaction handle
 * @param raw      - Raw (un-normalised) source text
 * @param srcLang  - Source language code
 * @param tgtLang  - Target language code
 * @param model    - LLM model identifier
 * @param translated - The translated text to cache
 */
export async function cacheStore(
  db: Tx,
  raw: string,
  srcLang: string,
  tgtLang: string,
  model: string,
  translated: string,
): Promise<void> {
  const norm = normalizeForHash(raw);
  await db.query(
    `INSERT INTO translation_cache (text_norm, src_lang, tgt_lang, model, translated)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (text_norm, src_lang, tgt_lang, model) DO UPDATE SET translated = EXCLUDED.translated, created_at = NOW()`,
    [norm, srcLang, tgtLang, model, translated],
  );
}
