// Shared helper: ingest CSV rows into the DB for a given mod + locale.
import { upsertRecord, insertString, type Tx } from '../db';
import { normalizeForHash, normalizeNoPunct } from './textNorm';
import { sha1Hex } from './hash';
import type { CsvRow } from '../types';
import { log } from '../logger';

/**
 * Persist an array of parsed CSV rows to the database for the given mod and language.
 *
 * For each row:
 * 1. Upserts a `records` row keyed by signature + path + EDID + hash.
 * 2. Inserts a `strings` row with the normalised source text and provenance metadata.
 *
 * Side effects: writes to `records` and `strings` tables via the provided transaction handle.
 *
 * @param db         - Active database transaction or connection.
 * @param modId      - Database ID of the parent mod.
 * @param rows       - Parsed CSV rows to persist.
 * @param lang       - BCP-47 language tag for the source text (e.g. `en`, `uk`).
 * @param sourceKind - Provenance label written to `strings.source` (e.g. `csv`, `ba2`).
 * @returns Array of `{ recordId, stringId }` pairs in input row order.
 */
export const ingestCsvRows = async (
  db: Tx,
  modId: number,
  rows: CsvRow[],
  lang: string,
  sourceKind: string
): Promise<{ recordId: number; stringId: number }[]> => {
  log.info(`Ingest: ${rows.length} rows, lang=${lang}, source=${sourceKind}`);
  const results: { recordId: number; stringId: number }[] = [];
  for (const r of rows) {
    const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
    const hashNorm = sha1Hex(normalizeForHash(r.Source));
    const recId = await upsertRecord(db, modId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
    const strId = await insertString(db, recId, lang, r.Source, normalizeForHash(r.Source), sourceKind, r.LStringID ?? null, normalizeNoPunct(r.Source));
    results.push({ recordId: recId, stringId: strId });
  }
  log.debug(`Ingest: completed, ${results.length} records inserted`);
  return results;
}
