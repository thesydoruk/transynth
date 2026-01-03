// Shared helper: ingest CSV rows into the DB for a given mod + locale.
import { upsertRecord, insertString, type Tx } from '../db.js';
import { normalizeForHash } from './textNorm.js';
import { sha1Hex } from './hash.js';
import type { CsvRow } from '../types.js';

export function ingestCsvRows(
  db: Tx,
  modId: number,
  rows: CsvRow[],
  lang: string,
  sourceKind: string
): { recordId: number; stringId: number }[] {
  return rows.map(r => {
    const pathSimplified = r.Path.replace(/\[\d+\]/g, '');
    const hashNorm = sha1Hex(normalizeForHash(r.Source));
    const recId = upsertRecord(db, modId, r.Signature, r.Path, pathSimplified, r.EDID ?? null, hashNorm, r.FormID || null);
    const strId = insertString(db, recId, lang, r.Source, normalizeForHash(r.Source), sourceKind);
    return { recordId: recId, stringId: strId };
  });
}
