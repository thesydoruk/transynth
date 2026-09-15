/**
 * Import prep for archives without a Bethesda plugin (MCM / Interface only).
 */
import { CONFIG } from '../../../config';
import { trackModImportBulkResults, type DialogGraphImportContext } from '../../../import/bulk';
import {
  createModImportBatchWriter,
  type ModImportBatchWriter,
} from '../../../import/mod/run/batchWriter';
import type { ModImportRunContext } from '../../contract';

const emptyDialogGraphCtx = (): DialogGraphImportContext => ({
  dialogEdidByFormId: new Map(),
  speakerMap: new Map(),
  voiceSpeakerMap: new Map(),
  voiceFolderMap: new Map(),
  speakerIndex: {
    actors: new Map(),
    voiceFolders: new Map(),
    voiceTypeGenders: new Map(),
  },
  topicIdCache: new Map(),
});

/** Build a batch writer and source-lang defaults when there is no ESP to read. */
export const prepareExtrasOnlyImportContext = (
  ctx: ModImportRunContext,
): { batch: ModImportBatchWriter } => {
  ctx.selectedLocale.value = null;
  ctx.importSingleLocaleMode.value = false;

  const batch = createModImportBatchWriter({
    db: ctx.db,
    jobId: ctx.job.id,
    importModId: ctx.importModId!,
    importBatchSize: CONFIG.dbChunkSize,
    progressEvery: CONFIG.modImportProgressEvery,
    progressTotal: ctx.progressTotal.value,
    dialogGraphCtx: emptyDialogGraphCtx(),
    trackImportBatch: (results) => {
      if (!ctx.pruneStaleImportData) return;
      trackModImportBulkResults(results, ctx.keptImportRecordKeys, ctx.keptImportStringIds);
    },
    onProgress: ctx.onProgress,
    getImported: () => ctx.imported.value,
    setImported: (value) => {
      ctx.imported.value = value;
    },
    shouldStop: () => ctx.state.cancel || ctx.state.pause,
  });

  return { batch };
};
