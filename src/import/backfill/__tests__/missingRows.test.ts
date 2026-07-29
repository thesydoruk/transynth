import { describe, expect, it } from '@jest/globals';
import type { EspStringRow } from '../../../formats/esp';
import type { CsvRow } from '../../../types';
import { modImportRecordKey } from '../../bulk';
import { countRecordsBySignature, espRowRecordPath, selectMissingEspRows } from '../missingRows';

const row = (signature: string, path: string, formId: string, text = 'text'): EspStringRow => ({
  formId,
  signature,
  edid: '',
  path,
  text,
  isLstringId: false,
});

const keyOf = (r: EspStringRow): string =>
  modImportRecordKey(r.signature, espRowRecordPath(r), r.formId);

describe('backfill record diff', () => {
  it('builds the stored record path from signature and subrecord', () => {
    expect(espRowRecordPath(row('REFR', 'FULL', '00191F00'))).toBe('REFR\\FULL');
    expect(espRowRecordPath(row('INNR', 'WNAM[0]', '000A0001'))).toBe('INNR\\WNAM[0]');
  });

  it('keeps only rows whose record is absent from the database', () => {
    const stored = row('WEAP', 'FULL', '00000001');
    const missing = row('REFR', 'FULL', '00191F00');
    const rows = [stored, missing];

    expect(selectMissingEspRows(rows, new Set([keyOf(stored)]))).toEqual([missing]);
  });

  it('keeps every string of a missing record and skips every string of a stored one', () => {
    const storedFirst = row('INFO', 'NAM1', '00000010', 'first response');
    const storedSecond = row('INFO', 'NAM1', '00000010', 'second response');
    const missingFirst = row('INFO', 'NAM1', '00000011', 'new first');
    const missingSecond = row('INFO', 'NAM1', '00000011', 'new second');

    const result = selectMissingEspRows(
      [storedFirst, storedSecond, missingFirst, missingSecond],
      new Set([keyOf(storedFirst)]),
    );

    expect(result).toEqual([missingFirst, missingSecond]);
  });

  it('counts distinct records per signature, not strings', () => {
    const csvRow = (signature: string, path: string, formId: string): CsvRow => ({
      FormID: formId,
      Signature: signature,
      Path: `${signature}\\${path}`,
      Source: 'text',
    });
    const rows = [
      csvRow('REFR', 'FULL', '00000001'),
      csvRow('REFR', 'FULL', '00000002'),
      csvRow('INFO', 'NAM1', '00000003'),
      csvRow('INFO', 'NAM1', '00000003'),
    ];

    expect(countRecordsBySignature(rows)).toEqual([
      { signature: 'REFR', records: 2 },
      { signature: 'INFO', records: 1 },
    ]);
  });
});
