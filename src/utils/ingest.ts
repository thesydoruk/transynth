// Shared helper: ingest CSV rows into the DB for a given mod + locale.
import { upsertRecord, insertString, type Tx } from '../db.js';
import { normalizeForHash, normalizeNoPunct } from './textNorm.js';
import { sha1Hex } from './hash.js';
import type { CsvRow } from '../types.js';
import { log } from '../logger.js';

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
