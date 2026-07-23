import fs from 'node:fs';
import pg from 'pg';
import type { Tx } from '../../../db';
import { clearBa2Cache } from '../../../formats/ba2';
import { CONFIG } from '../../../config';
import { logImport } from '../../../logging/loggers';
import type { GameType } from '../../../types';
import {
  tryBeginDeferredImportIndexes,
  restoreDeferredImportIndexes,
  withModImportWriteLock,
} from '../modImportIndexes';
import { beginActiveImport, endActiveImport, isModImportRunning } from './activeJobs';
import { getModImportJob } from './jobs';
import { markFailed } from './importJobStatus';
import {
  ensureImportModId,
  prepareEspImportContext,
  type ModImportPhaseContext,
} from './runImportPhases';
import { importEspStringRows } from './runImportEspPhase';
import {
  importMcmStringRows,
  importPexStringRows,
  finalizeModImportJob,
} from './runImportExtrasPhase';
import type { ModImportJob, ProgressCb } from './types';

const { Pool } = pg;

export const runModImport = async (
  db: Tx,
  job: ModImportJob,
  onProgress?: ProgressCb,
): Promise<ModImportJob> => {
  if (job.status === 'completed') return job;
  if (isModImportRunning(job.id)) throw new Error(`Mod Import #${job.id} is already running`);

  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Plugin file not found');

  const state = beginActiveImport(job.id);
  const startTime = Date.now();
  let releaseClient: (() => void) | null = null;

  if (db instanceof Pool) {
    const client = (await db.connect()) as pg.PoolClient;
    db = client as Tx;
    releaseClient = () => client.release();
  }

  logImport.info(
    `[Mod Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${job.imported_records} ` +
      `(dbBatch=${CONFIG.dbChunkSize}, ioParallel=${CONFIG.modImportIoParallel}, deferIndexes=${CONFIG.modImportDeferIndexes})`,
  );

  let imported = job.imported_records;
  let deferredIndexes = false;

  try {
    await withModImportWriteLock(db, async () => {
      if (CONFIG.modImportDeferIndexes) {
        deferredIndexes = await tryBeginDeferredImportIndexes(db);
      }

      try {
        const game: GameType = (job.game as GameType) ?? 'fo4';
        const ctx: ModImportPhaseContext = {
          db,
          job,
          state,
          espPath,
          game,
          importModId: job.mod_id,
          imported: { value: imported },
          progressTotal: { value: job.total_records },
          importSingleLocaleMode: { value: false },
          selectedLocale: { value: null },
          localeSources: [],
          pluginStringLang: 'en',
          pruneStaleImportData: job.imported_records === 0,
          keptImportRecordKeys: new Set<string>(),
          keptImportStringIds: new Set<number>(),
          onProgress,
          startTime,
        };

        ctx.importModId = await ensureImportModId(ctx);
        imported = ctx.imported.value;

        const prep = await prepareEspImportContext(ctx);
        imported = ctx.imported.value;

        const espOk = await importEspStringRows(ctx, prep);
        imported = ctx.imported.value;
        if (!espOk) return;

        await prep.batch.commitOpenTx();

        if (!state.cancel && !state.pause) {
          await importMcmStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
        }

        if (!state.cancel && !state.pause) {
          await importPexStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
          await prep.batch.commitOpenTx();
        }

        if (!state.cancel && !state.pause) {
          try {
            await finalizeModImportJob(ctx, prep.esp, prep.dialogGraphCtx.topicIdCache);
          } catch (err) {
            logImport.error(
              `[Mod Import #${job.id}] Failed to convert strings to translations: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        }
      } finally {
        if (deferredIndexes) {
          try {
            await restoreDeferredImportIndexes(db);
          } catch (err) {
            logImport.error(
              `[Mod Import #${job.id}] Failed to restore deferred search indexes: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          deferredIndexes = false;
        }
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logImport.error(`[Mod Import #${job.id}] Failed at ${imported} records: ${errMsg}`);
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    clearBa2Cache();
    endActiveImport(job.id);
    releaseClient?.();
  }

  return (await getModImportJob(db, job.id))!;
};
