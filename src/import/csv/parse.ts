import { iterCsvRows } from '../../utils/csv';
import type { CsvRecord } from './types';

const parseCsvRecordFields = (
  f: string[],
  cols: {
    iFormId: number;
    iSig: number;
    iEdid: number;
    iPath: number;
    iSource: number;
    iTarget: number;
    iStatus: number;
  },
): CsvRecord => {
  const statusRaw = cols.iStatus >= 0 ? (f[cols.iStatus] ?? '') : '';
  let statusByte = 0xff;
  if (statusRaw === 'confirmed') statusByte = 0x63;
  else if (statusRaw === 'untranslated') statusByte = 0xff;
  else if (/^\d+$/.test(statusRaw)) statusByte = Number(statusRaw);

  return {
    formId: cols.iFormId >= 0 ? (f[cols.iFormId] ?? '') : '',
    signature: cols.iSig >= 0 ? (f[cols.iSig] ?? '') : '',
    edid: cols.iEdid >= 0 ? (f[cols.iEdid] ?? '') : '',
    field: cols.iPath >= 0 ? (f[cols.iPath] ?? 'FULL') : 'FULL',
    source: cols.iSource >= 0 ? (f[cols.iSource] ?? '') : '',
    target: cols.iTarget >= 0 ? (f[cols.iTarget] ?? '') : '',
    status: statusByte,
  };
};

type CsvColumns = Parameters<typeof parseCsvRecordFields>[1];

const parseCsvHeader = (cols: string[]): CsvColumns => {
  const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  return {
    iFormId: idx('FormID'),
    iSig: idx('Signature'),
    iEdid: idx('EDID'),
    iPath: idx('Path'),
    iSource: idx('Source'),
    iTarget: idx('Target'),
    iStatus: idx('Status'),
  };
};

/**
 * Parse CSV text into structured {@link CsvRecord} objects.
 *
 * The header row is used to locate columns by name (case-insensitive). Unknown
 * or missing columns are treated as empty strings / defaults. A quoted field
 * may span several lines (RFC 4180).
 */
export const parseCsvRecords = (text: string): CsvRecord[] => [...iterCsvRecords(text)];

/**
 * Iterate parsed CSV records one-by-one.
 *
 * Yields records lazily so callers can preview data without allocating the
 * entire record list.
 */
export function* iterCsvRecords(text: string): Generator<CsvRecord> {
  let fields: CsvColumns | null = null;
  for (const row of iterCsvRows(text)) {
    if (!fields) {
      fields = parseCsvHeader(row);
      continue;
    }
    yield parseCsvRecordFields(row, fields);
  }
}
