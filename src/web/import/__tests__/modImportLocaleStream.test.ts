import { describe, it, expect } from '@jest/globals';
import type { EspStringRow } from '../../../formats/esp';
import {
  countImportRowsForLocale,
  generateImportCsvRows,
  localeFromStringsFileName,
  estimateLocalizedImportTotal,
} from '../modImportLocaleStream';

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

describe('localeFromStringsFileName', () => {
  it('parses locale tags from STRINGS paths', () => {
    expect(localeFromStringsFileName('Mod_en.STRINGS')).toBe('en');
    expect(localeFromStringsFileName('Strings\\Mod_ru.DLSTRINGS')).toBe('ru');
  });
});

describe('generateImportCsvRows', () => {
  it('resolves lstring ids and keeps inline text', () => {
    const map = new Map<number, string>([[42, 'Resolved']]);
    const rows = [...generateImportCsvRows(espRows, map)];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.Source).toBe('Resolved');
    expect(rows[0]?.LStringID).toBe(42);
    expect(rows[1]?.Source).toBe('Inline text');
  });

  it('skips unresolved lstring refs', () => {
    const rows = [...generateImportCsvRows(espRows, new Map())];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Source).toBe('Inline text');
  });
});

describe('countImportRowsForLocale', () => {
  it('matches generator row count', () => {
    const map = new Map<number, string>([[42, 'Resolved']]);
    expect(countImportRowsForLocale(espRows, map)).toBe(2);
    expect(countImportRowsForLocale(espRows, null)).toBe(1);
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
    );
    expect(total).toBe(2);
  });
});
