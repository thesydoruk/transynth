import { executeLangpackExport } from './runJob';
import type { LangpackExportJobParams } from '../../../../src/web/export/runLangpackExport';
import type { JobHandler } from '../../types';

export const langpackExportHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as LangpackExportJobParams;
  return executeLangpackExport(db, params, {
    isCancelled: ctx.isCancelled,
    onProgress: (done, total) => {
      ctx.emit({ type: 'progress', done, total, archiveId: params.archiveId });
    },
  });
};
