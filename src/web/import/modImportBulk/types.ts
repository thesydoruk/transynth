import type { CsvRow } from '../../../types';

export type ModImportBulkRow = {
  csvRow: CsvRow;
  locale: string;
  context: string | null;
  sourceKind?: string;
};

export type ModImportBulkResult = {
  recordId: number;
  stringId: number;
  row: ModImportBulkRow;
};

export type DialogGraphImportContext = {
  dialogEdidByFormId: Map<string, string>;
  speakerMap: Map<string, string>;
  voiceSpeakerMap: Map<string, string>;
  topicIdCache: Map<string, number>;
};

export type DialogInfoImportRow = {
  topicFormId: string;
  infoFormId: string;
  stringId: number;
  speakerFormId: string | null;
  speakerName: string | null;
  previousInfoFormId: string | null;
  locale: string;
};

export type PruneStaleModImportResult = {
  deletedStrings: number;
  deletedRecords: number;
};

export type BulkTranslationRow = {
  srcStringId: number;
  text: string;
};

export type SqlConvertImportTranslationsResult = {
  inserted: number;
  skippedWithoutSource: number;
  locales: string[];
  resolvedSourceLocale: string;
};
