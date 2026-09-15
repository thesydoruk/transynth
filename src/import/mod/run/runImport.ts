/**
 * The mod ingestion loop.
 *
 * Owns everything that is the same for every game: the advisory write lock, the
 * `mods` row, the shared run context, progress bookkeeping, and marking the job
 * failed. Reading the mod itself belongs to the game's import adapter, which
 * this calls once via `ingest`.
 */
import fs from 'node:fs';
import pg from 'pg';
import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { gamePlugin } from '../../../games/registry';
import type { ModImportRunContext } from '../../../games/contract';
import { logImport } from '../../../logging/loggers';
import { withModImportWriteLock } from '../../locks';
import { getModImportJob } from '../jobs';
import { markFailed } from '../jobStatus';
import {
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  isImportAllLocalesRequest,
  resolveModStringsLang,
} from '../localeHelpers';
import { beginActiveImport, endActiveImport, isModImportRunning } from './activeJobs';
import { ensureImportModId } from './context';
import type { ModImportJob, ProgressCb } from '../types';

const { Pool } = pg;

export const runModImport = async (
  db: Tx,
  job: ModImportJob,
  onProgress?: ProgressCb,
): Promise<ModImportJob> => {
  if (job.status === 'completed') return job;
  if (isModImportRunning(job.id)) throw new Error(`Mod Import #${job.id} is already running`);

  const anchorPath = job.esp_path;
  if (!anchorPath || !fs.existsSync(anchorPath)) throw new Error('Import anchor file not found');

  const plugin = gamePlugin(job.game);
  const state = beginActiveImport(job.id);
  const startTime = Date.now();
  let releaseClient: (() => void) | null = null;

  if (db instanceof Pool) {
    const client = (await db.connect()) as pg.PoolClient;
    db = client as Tx;
    releaseClient = () => client.release();
  }

  logImport.info(
    `[Mod Import #${job.id}] Starting ${plugin.id} import of "${job.file_name}" — ${job.total_records} records, ` +
      `resuming from ${job.imported_records} ` +
      `(dbBatch=${CONFIG.dbChunkSize}, ioParallel=${CONFIG.modImportIoParallel})`,
  );

  let imported = job.imported_records;

  try {
    await withModImportWriteLock(db, async () => {
      const ctx: ModImportRunContext = {
        db,
        job,
        state,
        anchorPath,
        game: plugin.id,
        importModId: job.mod_id,
        imported: { value: imported },
        progressTotal: { value: job.total_records },
        pluginStringLang: resolveModStringsLang(
          isImportAllLocalesRequest(job.src_lang) ? MOD_IMPORT_DEFAULT_SOURCE_LOCALE : job.src_lang,
        ),
        importSingleLocaleMode: { value: false },
        selectedLocale: { value: null },
        pruneStaleImportData: job.imported_records === 0,
        keptImportRecordKeys: new Set<string>(),
        keptImportStringIds: new Set<number>(),
        onProgress,
        startTime,
      };

      ctx.importModId = await ensureImportModId(ctx);
      imported = ctx.imported.value;

      try {
        await plugin.import.ingest(ctx);
      } finally {
        imported = ctx.imported.value;
      }
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logImport.error(`[Mod Import #${job.id}] Failed at ${imported} records: ${errMsg}`);
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    endActiveImport(job.id);
    releaseClient?.();
  }

  return (await getModImportJob(db, job.id))!;
};
