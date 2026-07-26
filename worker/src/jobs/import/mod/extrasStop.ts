/**
 * Cooperative cancel/pause checks for MCM and PEX import phases.
 */
import { logImport } from '../../../../../src/logging/loggers';
import { markFailed, markPaused } from '../../../../../src/import/mod/jobStatus';
import type { ModImportPhaseContext } from './phases';

/** True when cancel/pause was requested — does not touch DB status. */
export const extrasStopRequested = (ctx: ModImportPhaseContext): boolean =>
  ctx.state.cancel || ctx.state.pause;

/** Persist cancelled/paused status once when extras stop mid-phase. */
export const commitExtrasStop = async (ctx: ModImportPhaseContext): Promise<void> => {
  if (ctx.state.cancel) {
    await markFailed(ctx.db, ctx.job.id, ctx.imported.value);
    logImport.info(
      `Mod Import #${ctx.job.id} cancelled at ${ctx.imported.value}/${ctx.progressTotal.value}`,
    );
    return;
  }
  if (ctx.state.pause) {
    await markPaused(ctx.db, ctx.job.id, ctx.imported.value);
    logImport.info(
      `Mod Import #${ctx.job.id} paused at ${ctx.imported.value}/${ctx.progressTotal.value}`,
    );
  }
};
