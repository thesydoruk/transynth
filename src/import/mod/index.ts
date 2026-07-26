/**
 * Native mod import pipeline — job CRUD, file discovery and registration.
 *
 * Everything here is safe to use from the API process. The ingestion loop
 * itself lives in the worker (`worker/src/jobs/import/mod`).
 */
export type { ModImportJob, ModScanContext, ProgressCb, ModFileCandidate } from './types';
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
export { MOD_IMPORT_DEFAULT_SOURCE_LOCALE } from './localeHelpers';
export { isArchive, isPlugin, discoverModFiles, listModFilesInDirectory } from './discovery';
export { registerPluginFile, registerArchiveFile } from './registration';
export { markFailed } from './jobStatus';
export { alignmentKeyedStrings } from './alignment';
