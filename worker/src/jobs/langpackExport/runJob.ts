import type { Tx } from '../../../../src/db';
import { finalizeExportArchive } from '../../../../src/web/data/queries';
import { removeExportArchiveFiles } from '../../../../src/web/export/exportArchiveFiles';
import {
  runLangpackExportJob,
  type LangpackExportJobParams,
} from '../../../../src/web/export/runLangpackExport';
import type { JobResult } from '../../types';

export const executeLangpackExport = async (
  db: Tx,
  params: LangpackExportJobParams,
  opts: {
    isCancelled: () => boolean;
    onProgress: (done: number, total: number) => void;
  },
): Promise<JobResult> => {
  try {
    const result = await runLangpackExportJob(db, params, opts);
    await finalizeExportArchive(db, params.archiveId, {
      status: result.status,
      error: result.error,
      relPath: result.relPath,
      byteSize: result.byteSize,
    });
    if (result.status !== 'completed') {
      removeExportArchiveFiles(params.archiveId);
    }
    return {
      status: result.status,
      error: result.error,
      done: result.done,
      total: result.total,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const cancelled = opts.isCancelled() || message === 'cancelled';
    await finalizeExportArchive(db, params.archiveId, {
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? null : message,
    });
    removeExportArchiveFiles(params.archiveId);
    return {
      status: cancelled ? 'cancelled' : 'failed',
      error: cancelled ? null : message,
    };
  }
};
