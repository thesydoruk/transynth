import {
  dedupeBulkTranslationRows,
  dedupeDialogInfoRowsForImport,
  modImportRecordKey,
  parseModImportRecordKey,
  stringAlignKeySql,
  trackModImportBulkResults,
} from '..';

describe('modImportRecordKey', () => {
  it('combines signature, path, and form id', () => {
    expect(modImportRecordKey('INFO', 'NAM1', '01001234')).toBe(
      ['INFO', 'NAM1', '01001234'].join('\0'),
    );
  });
});

describe('parseModImportRecordKey', () => {
  it('round-trips modImportRecordKey', () => {
    const key = modImportRecordKey('PEX', 'PEX\\CraftingScript', '');
    expect(parseModImportRecordKey(key)).toEqual({
      signature: 'PEX',
      path: 'PEX\\CraftingScript',
      formId: '',
    });
  });
});

describe('trackModImportBulkResults', () => {
  it('collects record keys and string ids from bulk results', () => {
    const keptRecordKeys = new Set<string>();
    const keptStringIds = new Set<number>();
    trackModImportBulkResults(
      [
        {
          recordId: 1,
          stringId: 42,
          row: {
            csvRow: {
              FormID: '0100ABCD',
              Signature: 'INFO',
              Path: 'NAM1',
              Source: 'Hello',
            },
            locale: 'en',
            context: null,
          },
        },
      ],
      keptRecordKeys,
      keptStringIds,
    );

    expect([...keptRecordKeys]).toEqual([modImportRecordKey('INFO', 'NAM1', '0100ABCD')]);
    expect([...keptStringIds]).toEqual([42]);
  });
});

describe('dedupeDialogInfoRowsForImport', () => {
  it('merges duplicate INFO rows into one node and keeps every known field', () => {
    const rows = dedupeDialogInfoRowsForImport([
      {
        topicFormId: '0100ABCD',
        infoFormId: '0100EF01',
        speakerFormId: null,
        speakerName: null,
        speakerKey: null,
        previousInfoFormId: '0100EE00',
      },
      {
        topicFormId: '0100ABCD',
        infoFormId: '0100EF01',
        speakerFormId: '01009999',
        speakerName: 'Nick',
        speakerKey: 'npc:01009999',
        previousInfoFormId: null,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      topicFormId: '0100ABCD',
      infoFormId: '0100EF01',
      speakerFormId: '01009999',
      speakerName: 'Nick',
      speakerKey: 'npc:01009999',
      previousInfoFormId: '0100EE00',
    });
  });

  it('keeps distinct INFO rows', () => {
    const rows = dedupeDialogInfoRowsForImport([
      {
        topicFormId: '0100ABCD',
        infoFormId: '0100EF01',
        speakerFormId: null,
        speakerName: null,
        speakerKey: null,
        previousInfoFormId: null,
      },
      {
        topicFormId: '0100ABCD',
        infoFormId: '0100EF02',
        speakerFormId: null,
        speakerName: null,
        speakerKey: null,
        previousInfoFormId: null,
      },
    ]);

    expect(rows).toHaveLength(2);
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

describe('stringAlignKeySql', () => {
  it('matches alignmentKeyedStrings lstring and inline key shapes', () => {
    const expr = stringAlignKeySql('s');
    expect(expr).toContain("':L' || s.lstring_id::text");
    expect(expr).toContain("':P' ||");
    expect(expr).toContain('PARTITION BY s.record_id, s.lang');
    expect(expr).toContain('ORDER BY s.id');
  });
});

describe('bulkUpsertAutoTranslations', () => {
  it('is exported alongside import bulk helper', async () => {
    const { bulkUpsertAutoTranslations } = await import('..');
    expect(typeof bulkUpsertAutoTranslations).toBe('function');
  });
});
