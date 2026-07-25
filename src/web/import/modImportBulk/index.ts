/**
 * Bulk database writes for mod import (records, strings, translations).
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

export { pruneOrphanDialogGraph } from './pruneDialogGraph';

export { bulkInsertModImportRows } from './bulkInsert';

export {
  dedupeBulkTranslationRows,
  stringAlignKeySql,
  sqlConvertImportedStringsToTranslations,
  bulkUpsertImportTranslations,
  bulkUpsertAutoTranslations,
} from './translations';
