/**
 * Native mod import pipeline used by the web UI.
 *
 * @see modImportService.ts (removed) — split into domain modules in this folder.
 */
export type {
  ModImportJob,
  ModScanContext,
  ModPreviewRow,
  ModImportApplyRow,
  ProgressCb,
  ModImportLocaleInfo,
  ChangeModImportLocaleResult,
  ModFileCandidate,
} from './types';
export type { ImportStringRow } from './alignment';

export { modScanContextFromVortex } from './scanContext';
export { ensureModImportSchema } from './schema';
export {
  listModImportJobs,
  getModImportJob,
  updateModJobLanguages,
  restartModImportJob,
  deleteModImportJob,
} from './jobs';
export { MOD_IMPORT_DEFAULT_SOURCE_LOCALE, isImportAllLocalesRequest } from './localeHelpers';
export {
  getModImportLocaleInfo,
  changeModImportLocaleInDb,
  validateModImportLocaleSelection,
} from './localeManagement';
export { extractModImportApplyRows } from './applyRows';
export {
  isArchive,
  isPlugin,
  extractArchive,
  discoverModFiles,
  listModFilesInDirectory,
} from './discovery';
export { registerPluginFile, registerArchiveFile } from './registration';
export { previewModRecords } from './preview';
export { isModImportRunning, requestModCancel, requestModPause } from './activeJobs';
export { alignmentKeyedStrings } from './alignment';
export { runModImport } from './runImport';
