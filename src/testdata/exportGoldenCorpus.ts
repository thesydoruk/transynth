import type { StringsType } from '../bethesda/StringsFile.js';

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
}
