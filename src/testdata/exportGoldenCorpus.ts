import type { StringsType } from '../formats/strings';

/**
 * Canonical localized strings file used by the export regression suite.
 *
 * The corpus is intentionally synthetic and small enough to inspect in code,
 * while still covering the three Bethesda string table variants and UTF-8 text.
 */
export interface GoldenStringsFileFixture {
  fileName: string;
  type: StringsType;
  entries: Array<{ id: number; text: string }>;
}

/**
 * Canonical localized export scenario used to prove the current export
 * invariants against a stable corpus.
 */
export interface LocalizedExportGoldenCorpus {
  pluginFileName: string;
  sourceLang: string;
  targetLang: string;
  sourceFiles: GoldenStringsFileFixture[];
  translationOverlay: Array<{ id: number; text: string }>;
  /** DB-shaped rows for typed overlay export (signature + path → table routing). */
  translationOverlayRows: Array<{
    lstring_id: number;
    signature: string;
    path: string;
    export_text: string;
  }>;
  expectedFiles: GoldenStringsFileFixture[];
}

/**
 * Synthetic golden corpus for localized export regression tests.
 *
 * Invariants covered by this corpus:
 * - all three strings table formats round-trip without ID drift
 * - UTF-8 text survives serialization
 * - export preserves the file inventory and basename casing
 * - untranslated IDs fall back to source text
 * - overlay IDs absent from a source file are ignored
 */
export const LOCALIZED_EXPORT_GOLDEN_CORPUS: LocalizedExportGoldenCorpus = {
  pluginFileName: 'GoldenWorkshop.esp',
  sourceLang: 'en',
  targetLang: 'uk',
  sourceFiles: [
    {
      fileName: 'GoldenWorkshop_en.STRINGS',
      type: 'STRINGS',
      entries: [
        { id: 101, text: 'Use <Activate> to open the workshop.' },
        { id: 102, text: 'Power required' },
      ],
    },
    {
      fileName: 'GoldenWorkshop_en.DLSTRINGS',
      type: 'DLSTRINGS',
      entries: [
        { id: 201, text: 'War. War never changes.' },
        { id: 202, text: 'Another settlement needs your help.' },
      ],
    },
    {
      fileName: 'GoldenWorkshop_en.ILSTRINGS',
      type: 'ILSTRINGS',
      entries: [
        { id: 301, text: 'Quest added.' },
        { id: 302, text: 'UTF-8 source: Привіт, Commonwealth.' },
      ],
    },
  ],
  translationOverlay: [
    { id: 101, text: 'Натисніть <Activate>, щоб відкрити майстерню.' },
    { id: 201, text: 'Війна. Війна ніколи не змінюється.' },
    { id: 302, text: 'UTF-8 переклад: Привіт, Співдружність.' },
    { id: 9999, text: 'This ID is absent from source files and must be ignored.' },
  ],
  translationOverlayRows: [
    {
      lstring_id: 101,
      signature: 'ACTI',
      path: 'ACTI\\FULL',
      export_text: 'Натисніть <Activate>, щоб відкрити майстерню.',
    },
    {
      lstring_id: 201,
      signature: 'BOOK',
      path: 'BOOK\\DESC',
      export_text: 'Війна. Війна ніколи не змінюється.',
    },
    {
      lstring_id: 302,
      signature: 'INFO',
      path: 'INFO\\NAM1',
      export_text: 'UTF-8 переклад: Привіт, Співдружність.',
    },
    {
      lstring_id: 9999,
      signature: 'MISC',
      path: 'MISC\\FULL',
      export_text: 'This ID is absent from source files and must be ignored.',
    },
  ],
  expectedFiles: [
    {
      fileName: 'GoldenWorkshop_uk.STRINGS',
      type: 'STRINGS',
      entries: [
        { id: 101, text: 'Натисніть <Activate>, щоб відкрити майстерню.' },
        { id: 102, text: 'Power required' },
      ],
    },
    {
      fileName: 'GoldenWorkshop_uk.DLSTRINGS',
      type: 'DLSTRINGS',
      entries: [
        { id: 201, text: 'Війна. Війна ніколи не змінюється.' },
        { id: 202, text: 'Another settlement needs your help.' },
      ],
    },
    {
      fileName: 'GoldenWorkshop_uk.ILSTRINGS',
      type: 'ILSTRINGS',
      entries: [
        { id: 301, text: 'Quest added.' },
        { id: 302, text: 'UTF-8 переклад: Привіт, Співдружність.' },
      ],
    },
  ],
};

/**
 * Convert fixture entries into a Map shape expected by the format helpers.
 *
 * @param file - Corpus file fixture.
 * @returns id -> text map.
 */
export const goldenFixtureToMap = (file: GoldenStringsFileFixture): Map<number, string> => {
  return new Map(file.entries.map(({ id, text }) => [id, text]));
};
