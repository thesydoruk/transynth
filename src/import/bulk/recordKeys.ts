import type { ModImportBulkResult } from './types';

/** Natural key for `records` upsert (matches ON CONFLICT target). */
export const modImportRecordKey = (signature: string, path: string, formId: string): string =>
  `${signature}\0${path}\0${formId}`;

/** Inverse of {@link modImportRecordKey}. */
export const parseModImportRecordKey = (
  key: string,
): { signature: string; path: string; formId: string } => {
  const parts = key.split('\0');
  if (parts.length < 3) {
    throw new Error(`Invalid mod import record key: ${key}`);
  }
  const formId = parts.pop()!;
  const path = parts.pop()!;
  const signature = parts.join('\0');
  return { signature, path, formId };
};

/** Accumulate record/string ids from one bulk insert batch for stale-row pruning. */
export const trackModImportBulkResults = (
  results: ModImportBulkResult[],
  keptRecordKeys: Set<string>,
  keptStringIds: Set<number>,
): void => {
  for (const res of results) {
    const row = res.row.csvRow;
    keptRecordKeys.add(modImportRecordKey(row.Signature, row.Path, row.FormID || ''));
    keptStringIds.add(res.stringId);
  }
};
