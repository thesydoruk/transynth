/**
 * Native mod ingestion loop (worker process only).
 *
 * Runs the phases in order — mod row, ESP strings, MCM, PEX, finalize — under a
 * single advisory write lock so concurrent imports cannot interleave their
 * writes. Each phase updates `ctx.imported` so a pause or cancel between phases
 * still records accurate progress.
 */
import fs from 'node:fs';
import pg from 'pg';
import type { Tx } from '../../../../../src/db';
import { clearBa2Cache } from '../../../../../src/formats/ba2';
import { CONFIG } from '../../../../../src/config';
import { logImport } from '../../../../../src/logging/loggers';
import type { GameType } from '../../../../../src/types';
import { withModImportWriteLock } from '../../../../../src/import/locks';
import { isPluginPath } from '../../../../../src/import/mod/discovery';
import { beginActiveImport, endActiveImport, isModImportRunning } from './activeJobs';
import { getModImportJob } from '../../../../../src/import/mod/jobs';
import { markFailed } from '../../../../../src/import/mod/jobStatus';
import { ensureImportModId, prepareEspImportContext, type ModImportPhaseContext } from './phases';
import { importEspStringRows } from './espPhase';
import {
  importInterfaceTranslateRows,
  importMcmStringRows,
  importPexStringRows,
} from './extrasPhase';
import { importDiscoPoStringRows } from './discoPoPhase';
import { prepareExtrasOnlyImportContext } from './extrasOnlyPrep';
import { finalizeModImportJob } from './finalizePhase';
import type { ModImportJob, ProgressCb } from '../../../../../src/import/mod/types';

const { Pool } = pg;

export const runModImport = async (
  db: Tx,
  job: ModImportJob,
  onProgress?: ProgressCb,
): Promise<ModImportJob> => {
  if (job.status === 'completed') return job;
  if (isModImportRunning(job.id)) throw new Error(`Mod Import #${job.id} is already running`);

  const espPath = job.esp_path;
  if (!espPath || !fs.existsSync(espPath)) throw new Error('Import anchor file not found');

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
      `(dbBatch=${CONFIG.dbChunkSize}, ioParallel=${CONFIG.modImportIoParallel})`,
  );

  let imported = job.imported_records;

  try {
    await withModImportWriteLock(db, async () => {
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

      if (isPluginPath(ctx.espPath)) {
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
          await importInterfaceTranslateRows(ctx, prep.batch);
          imported = ctx.imported.value;
        }

        if (!state.cancel && !state.pause) {
          await importPexStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
          await prep.batch.commitOpenTx();
        }

        if (!state.cancel && !state.pause) {
          try {
            await finalizeModImportJob(ctx, prep.esp, prep.dialogGraphCtx);
          } catch (err) {
            logImport.error(
              `[Mod Import #${job.id}] Failed to convert strings to translations: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        }
        return;
      }

      logImport.info(
        `[Mod Import #${job.id}] No plugin anchor — importing extras only` +
          (game === 'disco' ? ' (Disco Final Cut .po)' : ' (MCM/Interface/PEX)'),
      );
      const prep = prepareExtrasOnlyImportContext(ctx);

      if (game === 'disco') {
        if (!state.cancel && !state.pause) {
          await importDiscoPoStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
          await prep.batch.commitOpenTx();
        }
      } else {
        if (!state.cancel && !state.pause) {
          await importMcmStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
        }

        if (!state.cancel && !state.pause) {
          await importInterfaceTranslateRows(ctx, prep.batch);
          imported = ctx.imported.value;
        }

        if (!state.cancel && !state.pause) {
          await importPexStringRows(ctx, prep.batch);
          imported = ctx.imported.value;
          await prep.batch.commitOpenTx();
        }
      }

      if (!state.cancel && !state.pause) {
        try {
          await finalizeModImportJob(ctx, null, null);
        } catch (err) {
          logImport.error(
            `[Mod Import #${job.id}] Failed to convert strings to translations: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
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
