/**
 * LLM Translation Cache Service.
 *
 * Provides lookup and store operations for the `translation_cache` table.
 * The cache key is `(text_norm_hash, src_lang, tgt_lang, model)` where
 * `text_norm_hash` is SHA-256 of normalised source text. Full `text_norm` is
 * stored for verification but not indexed (long keys exceed btree row limits).
 */

import type { Tx } from '../../db';
import { hashNormForCache, normalizeForHash } from '../../utils/textNorm';
import { logCache } from '../../logging/loggers';

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
export const cacheLookup = async (
  db: Tx,
  raw: string,
  srcLang: string,
  tgtLang: string,
  model: string,
): Promise<CacheHit | null> => {
  const norm = normalizeForHash(raw);
  const normHash = hashNormForCache(norm);
  const { rows } = await db.query<{ translated: string }>(
    `SELECT translated FROM translation_cache
     WHERE text_norm_hash = $1 AND text_norm = $2 AND src_lang = $3 AND tgt_lang = $4 AND model = $5
     LIMIT 1`,
    [normHash, norm, srcLang, tgtLang, model],
  );
  const hit = rows[0] ? { translated: rows[0].translated } : null;
  if (hit) {
    logCache.trace('lookup hit', { srcLang, tgtLang, model, textLen: raw.length });
  } else {
    logCache.trace('lookup miss', { srcLang, tgtLang, model, textLen: raw.length });
  }
  return hit;
};

/**
 * Look up many cached translations in a single round trip.
 *
 * Replaces N sequential {@link cacheLookup} calls (one DB round trip each — very
 * slow against a remote database) with one `text_norm = ANY(...)` query. The
 * returned map is keyed by the *raw* source text so callers don't need to
 * re-normalise; multiple raws that normalise to the same key all resolve.
 *
 * @returns Map of raw source text → cached translation (only hits are present).
 */
export const cacheLookupMany = async (
  db: Tx,
  raws: string[],
  srcLang: string,
  tgtLang: string,
  model: string,
): Promise<Map<string, string>> => {
  const byRaw = new Map<string, string>();
  if (raws.length === 0) return byRaw;

  const normToRaws = new Map<string, string[]>();
  for (const raw of raws) {
    const norm = normalizeForHash(raw);
    const existing = normToRaws.get(norm);
    if (existing) existing.push(raw);
    else normToRaws.set(norm, [raw]);
  }

  const normHashes = [...normToRaws.keys()].map((norm) => hashNormForCache(norm));

  const { rows } = await db.query<{ text_norm: string; translated: string }>(
    `SELECT text_norm, translated FROM translation_cache
     WHERE src_lang = $2 AND tgt_lang = $3 AND model = $4
       AND text_norm_hash = ANY($1::char(64)[])`,
    [normHashes, srcLang, tgtLang, model],
  );

  for (const row of rows) {
    for (const raw of normToRaws.get(row.text_norm) ?? []) {
      byRaw.set(raw, row.translated);
    }
  }
  logCache.debug('lookupMany', {
    srcLang,
    tgtLang,
    model,
    requested: normToRaws.size,
    hits: rows.length,
  });
  return byRaw;
};

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
export type CacheStoreEntry = {
  raw: string;
  translated: string;
};

export const cacheStore = async (
  db: Tx,
  raw: string,
  srcLang: string,
  tgtLang: string,
  model: string,
  translated: string,
): Promise<void> => {
  await cacheStoreMany(db, [{ raw, translated }], srcLang, tgtLang, model);
};

/**
 * Store many LLM translation results in one round trip.
 *
 * Deduplicates by normalised source key (last translation wins), matching
 * {@link cacheLookupMany} behaviour for keys that normalise identically.
 */
export const cacheStoreMany = async (
  db: Tx,
  entries: CacheStoreEntry[],
  srcLang: string,
  tgtLang: string,
  model: string,
): Promise<void> => {
  if (entries.length === 0) return;

  const byNorm = new Map<string, { norm: string; normHash: string; translated: string }>();
  for (const entry of entries) {
    const norm = normalizeForHash(entry.raw);
    byNorm.set(norm, {
      norm,
      normHash: hashNormForCache(norm),
      translated: entry.translated,
    });
  }

  const norms = [...byNorm.values()];
  await db.query(
    `INSERT INTO translation_cache (text_norm, text_norm_hash, src_lang, tgt_lang, model, translated)
     SELECT n, h, $2, $3, $4, t
     FROM UNNEST($1::text[], $5::char(64)[], $6::text[]) AS u(n, h, t)
     ON CONFLICT (text_norm_hash, src_lang, tgt_lang, model) DO UPDATE SET
       text_norm = EXCLUDED.text_norm,
       translated = EXCLUDED.translated,
       created_at = NOW()`,
    [
      norms.map((row) => row.norm),
      srcLang,
      tgtLang,
      model,
      norms.map((row) => row.normHash),
      norms.map((row) => row.translated),
    ],
  );
  logCache.debug('storeMany', {
    srcLang,
    tgtLang,
    model,
    requested: entries.length,
    stored: norms.length,
  });
};
