import { describe, expect, it } from '@jest/globals';
import { iterEetRecords, parseEetFile, parseEetHeader } from '..';
import { buildEet, type EetFixtureRecord } from '../../../testing/eetFixture';

/*
 * The reader tests in eetReader.test.ts need sample files that are not in the
 * repository, so they assert nothing on a clean checkout. These run on files
 * built to the documented layout, everywhere.
 */
const RECORDS: EetFixtureRecord[] = [
  {
    signature: 'NPC_',
    formId: '0001F00A',
    edid: 'Sturges',
    field: 'FULL',
    source: 'Sturges',
    target: 'Стерджес',
    status: 0x63,
  },
  {
    signature: 'BOOK',
    formId: '01000FAA',
    edid: 'Journal',
    field: 'DESC',
    source: 'Day one.\r\nThe raiders came.',
    target: '',
  },
];

describe('parseEetHeader', () => {
  it('reads a v1 header, which declares no record count', () => {
    const header = parseEetHeader(buildEet(RECORDS, { version: 1, gameName: 'Skyrim' }));

    expect(header).toMatchObject({ version: 1, gameName: 'Skyrim', declaredCount: -1 });
  });

  it('reads a v2 header with its record count', () => {
    expect(parseEetHeader(buildEet(RECORDS, { version: 2 }))).toMatchObject({
      version: 2,
      gameName: 'Fallout 4',
      declaredCount: 2,
    });
  });

  it('rejects a file that is not EET', () => {
    expect(() => parseEetHeader(Buffer.from('NOT_EET_DATA_1234567890'))).toThrow(
      'Invalid EET magic',
    );
  });
});

describe('iterEetRecords', () => {
  it.each([1, 2] as const)(
    'reads every record of a v%i file, Unicode and line breaks intact',
    (version) => {
      const buf = buildEet(RECORDS, { version });
      const records = [...iterEetRecords(buf, parseEetHeader(buf).recordsOffset)];

      expect(records.map(({ offset: _offset, ...rest }) => rest)).toEqual([
        { ...RECORDS[0], status: 0x63 },
        { ...RECORDS[1], status: 0xff },
      ]);
    },
  );

  it('stops at a truncated record instead of reading past the end', () => {
    const buf = buildEet(RECORDS);
    const cut = buf.subarray(0, buf.length - 10);

    expect([...iterEetRecords(cut, parseEetHeader(cut).recordsOffset)]).toHaveLength(1);
  });
});

describe('parseEetFile', () => {
  it('returns the header and every record', () => {
    const { header, records } = parseEetFile(buildEet(RECORDS));

    expect(header.declaredCount).toBe(2);
    expect(records.map((record) => record.formId)).toEqual(['0001F00A', '01000FAA']);
  });
});
