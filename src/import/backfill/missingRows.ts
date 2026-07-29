/**
 * Diff a plugin against the records a mod already has in the database.
 *
 * The natural key is the same one the import upserts on
 * (`mod_id, signature, path, formid_hex`), so a record present in the database
 * keeps all of its strings and only genuinely new records are re-imported.
 */
import type { Tx } from '../../db';
import type { EspStringRow } from '../../formats/esp';
import type { CsvRow } from '../../types';
import { modImportRecordKey } from '../bulk';

/** Stored `records.path` for an extracted plugin row (e.g. `REFR\FULL`). */
export const espRowRecordPath = (row: EspStringRow): string => `${row.signature}\\${row.path}`;

const espRowRecordKey = (row: EspStringRow): string =>
  modImportRecordKey(row.signature, espRowRecordPath(row), row.formId || '');

export const loadExistingRecordKeys = async (db: Tx, modId: number): Promise<Set<string>> => {
  const { rows } = await db.query<{
    signature: string | null;
    path: string | null;
    formid_hex: string;
  }>('SELECT signature, path, formid_hex FROM records WHERE mod_id = $1', [modId]);
  return new Set(
    rows.map((row) => modImportRecordKey(row.signature ?? '', row.path ?? '', row.formid_hex)),
  );
};

/** Plugin rows whose record is absent from the database, in plugin order. */
export const selectMissingEspRows = (
  espRows: EspStringRow[],
  existingKeys: ReadonlySet<string>,
): EspStringRow[] => espRows.filter((row) => !existingKeys.has(espRowRecordKey(row)));

/**
 * Distinct record count per signature over the rows a backfill would write.
 *
 * Takes generated rows rather than raw plugin rows: a record whose lstring id
 * resolves to no text (a numeric `GMST\DATA`, for example) never reaches the
 * database and must not be reported as an addition.
 */
export const countRecordsBySignature = (
  rows: CsvRow[],
): Array<{ signature: string; records: number }> => {
  const seen = new Set<string>();
  const bySignature = new Map<string, number>();
  for (const row of rows) {
    const key = modImportRecordKey(row.Signature, row.Path, row.FormID || '');
    if (seen.has(key)) continue;
    seen.add(key);
    bySignature.set(row.Signature, (bySignature.get(row.Signature) ?? 0) + 1);
  }
  return [...bySignature.entries()]
    .map(([signature, records]) => ({ signature, records }))
    .sort((a, b) => b.records - a.records || a.signature.localeCompare(b.signature));
};
