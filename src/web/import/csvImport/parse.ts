import { parseCsvLine } from '../../../utils/csv';
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

const parseCsvHeader = (headerLine: string) => {
  const cols = parseCsvLine(headerLine);
  const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  return {
    cols,
    fields: {
      iFormId: idx('FormID'),
      iSig: idx('Signature'),
      iEdid: idx('EDID'),
      iPath: idx('Path'),
      iSource: idx('Source'),
      iTarget: idx('Target'),
      iStatus: idx('Status'),
    },
  };
};

/**
 * Parse CSV text into structured {@link CsvRecord} objects.
 *
 * The header row is used to locate columns by name (case-insensitive). Unknown
 * or missing columns are treated as empty strings / defaults.
 */
export const parseCsvRecords = (text: string): CsvRecord[] => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headerLine = lines.shift()!;
  const { fields } = parseCsvHeader(headerLine);

  const records: CsvRecord[] = [];
  for (const line of lines) {
    records.push(parseCsvRecordFields(parseCsvLine(line), fields));
  }
  return records;
};

/**
 * Iterate parsed CSV records one-by-one.
 *
 * This generator mirrors {@link parseCsvRecords} but yields records lazily so
 * callers can preview data without allocating the entire record list.
 */
export function* iterCsvRecords(text: string): Generator<CsvRecord> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return;

  const headerLine = lines.shift()!;
  const { fields } = parseCsvHeader(headerLine);

  for (const line of lines) {
    yield parseCsvRecordFields(parseCsvLine(line), fields);
  }
}
