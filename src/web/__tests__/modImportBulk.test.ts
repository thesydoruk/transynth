import { dedupeBulkTranslationRows, modImportRecordKey } from '../modImportBulk';

describe('modImportRecordKey', () => {
  it('combines signature, path, and form id', () => {
    expect(modImportRecordKey('INFO', 'NAM1', '01001234')).toBe(
      ['INFO', 'NAM1', '01001234'].join('\0'),
    );
  });
});

describe('dedupeBulkTranslationRows', () => {
  it('keeps the last text for duplicate string ids', () => {
    expect(
      dedupeBulkTranslationRows([
        { srcStringId: 1, text: 'a' },
        { srcStringId: 2, text: 'b' },
        { srcStringId: 1, text: 'c' },
      ]),
    ).toEqual([
      { srcStringId: 1, text: 'c' },
      { srcStringId: 2, text: 'b' },
    ]);
  });
});
