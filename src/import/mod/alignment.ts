/** Minimal `strings` row shape used when aligning locales to source strings. */
export interface ImportStringRow {
  id: number;
  record_id: number;
  lstring_id: number | null;
  text_raw: string;
}

/**
 * Compute a stable per-record alignment key for each string so that records
 * holding multiple strings are paired correctly across locales.
 *
 * - lstring-backed strings use their lstring id (identical across locales).
 * - inline strings (no lstring id) use a positional ordinal within the record;
 *   inline rows are ingested in the same order for every locale, so the Nth
 *   inline string of a record always refers to the same logical field.
 *
 * Input rows MUST be ordered by `(record_id, id)`.
 */
export const alignmentKeyedStrings = (
  rows: ImportStringRow[],
): { key: string; row: ImportStringRow }[] => {
  const inlineOrdinalByRecord = new Map<number, number>();
  return rows.map((row) => {
    let key: string;
    if (row.lstring_id != null) {
      key = `${row.record_id}:L${row.lstring_id}`;
    } else {
      const ordinal = inlineOrdinalByRecord.get(row.record_id) ?? 0;
      inlineOrdinalByRecord.set(row.record_id, ordinal + 1);
      key = `${row.record_id}:P${ordinal}`;
    }
    return { key, row };
  });
};
