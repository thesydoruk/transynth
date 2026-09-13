import { runVortexSyncJob, type VortexSyncJobParams } from './runJob';
import type { JobHandler } from '../../types';

export const vortexSyncHandler: JobHandler = (db, ctx) => {
  const params = ctx.data.params as VortexSyncJobParams;
  return runVortexSyncJob(db, params, { jobId: ctx.jobId, isCancelled: ctx.isCancelled });
};
