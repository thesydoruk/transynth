/**
 * Bulk database writes for imports (records, strings, translations, dialog
 * graph). `recordImport.ts` covers tabular CSV/EET rows and is imported
 * directly; this barrel serves the native mod import writers.
 */
export type {
  ModImportBulkRow,
  ModImportBulkResult,
  DialogGraphImportContext,
  DialogInfoImportRow,
  PruneStaleModImportResult,
  PruneDialogGraphResult,
  BulkTranslationRow,
  SqlConvertImportTranslationsResult,
} from './types';

export { dedupeDialogInfoRowsForImport, bulkUpsertDialogGraphForImportBatch } from './dialogGraph';

export {
  modImportRecordKey,
  parseModImportRecordKey,
  trackModImportBulkResults,
} from './recordKeys';

export { pruneStaleModImportData } from './pruneStale';

export { bulkInsertModImportRows } from './bulkInsert';

export {
  dedupeBulkTranslationRows,
  stringAlignKeySql,
  SQL_CONVERT_LSTRING_INSERT,
  SQL_CONVERT_INLINE_INSERT,
  sqlConvertImportedStringsToTranslations,
  bulkUpsertImportTranslations,
  bulkUpsertAutoTranslations,
} from './translations';
