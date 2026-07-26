import { describe, it, expect } from '@jest/globals';
import type { EspStringRow } from '../../../formats/esp';
import { localeFromStringsFileName } from '../localeSources';
import {
  countImportRowsForLocale,
  generateImportCsvRows,
  estimateLocalizedImportTotal,
  type LocaleStringsMaps,
} from '../localeRows';

const espRows: EspStringRow[] = [
  {
    formId: '01001234',
    signature: 'INFO',
    path: 'NAM1',
    edid: 'TestInfo',
    text: '42',
    isLstringId: true,
    dialogTopicFormId: undefined,
    previousInfoFormId: undefined,
    speakerFormId: undefined,
  },
  {
    formId: '01005678',
    signature: 'BOOK',
    path: 'FULL',
    edid: 'InlineBook',
    text: 'Inline text',
    isLstringId: false,
    dialogTopicFormId: undefined,
    previousInfoFormId: undefined,
    speakerFormId: undefined,
  },
];

const typedMaps = (
  entries: Partial<Record<'STRINGS' | 'DLSTRINGS' | 'ILSTRINGS', [number, string][]>>,
): LocaleStringsMaps =>
  new Map([
    ['STRINGS', new Map(entries.STRINGS ?? [])],
    ['DLSTRINGS', new Map(entries.DLSTRINGS ?? [])],
    ['ILSTRINGS', new Map(entries.ILSTRINGS ?? [])],
  ]);

describe('localeFromStringsFileName', () => {
  it('parses locale tags from STRINGS paths', () => {
    expect(localeFromStringsFileName('Mod_en.STRINGS')).toBe('en');
    expect(localeFromStringsFileName('Strings\\Mod_ru.DLSTRINGS')).toBe('ru');
  });
});

describe('generateImportCsvRows', () => {
  it('resolves INFO/NAM1 from ILSTRINGS table', () => {
    const maps = typedMaps({ ILSTRINGS: [[42, 'Resolved']] });
    const rows = [...generateImportCsvRows(espRows, maps, 'fo4')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.Source).toBe('Resolved');
    expect(rows[0]?.LStringID).toBe(42);
    expect(rows[1]?.Source).toBe('Inline text');
  });

  it('does not resolve NAM1 from wrong table when ids collide', () => {
    const maps = typedMaps({
      STRINGS: [[42, 'Wrong table']],
      ILSTRINGS: [],
    });
    const rows = [...generateImportCsvRows(espRows, maps, 'fo4')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Source).toBe('Inline text');
  });

  it('skips unresolved lstring refs', () => {
    const rows = [...generateImportCsvRows(espRows, typedMaps({}), 'fo4')];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Source).toBe('Inline text');
  });
});

describe('countImportRowsForLocale', () => {
  it('matches generator row count', () => {
    const maps = typedMaps({ ILSTRINGS: [[42, 'Resolved']] });
    expect(countImportRowsForLocale(espRows, maps, 'fo4')).toBe(2);
    expect(countImportRowsForLocale(espRows, null, 'fo4')).toBe(1);
  });
});

describe('estimateLocalizedImportTotal', () => {
  it('multiplies per-locale count by locale list length', () => {
    const inlineOnly: EspStringRow[] = [espRows[1]!];
    const total = estimateLocalizedImportTotal(
      inlineOnly,
      [
        { locale: 'en', files: [] },
        { locale: 'ru', files: [] },
      ],
      ['en', 'ru'],
      'fo4',
    );
    expect(total).toBe(2);
  });
});
