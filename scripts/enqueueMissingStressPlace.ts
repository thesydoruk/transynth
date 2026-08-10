#!/usr/bin/env tsx
/**
 * Enqueue stress-place (scope: missing) for mods that still have pending voiced lines.
 *
 * Usage:
 *   npx tsx scripts/enqueueMissingStressPlace.ts [--dry-run] [--shard 0/6] [--mod-id N]
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { loadModImportPaths } from '../src/import/mod/resolvePaths';
import { resolveImportPackages } from '../src/modImport';
import { countStressPlaceWork } from '../src/web/data/queries/stressPlacement';
import { allocateJobId, closeJobsQueue, enqueueJob } from '../worker/src/core/queue';
import { writeJobSnapshot } from '../worker/src/core/snapshots';
import { findActiveJobIdForMod } from '../worker/src/api/jobStatus';

const argv = await yargs(hideBin(process.argv))
  .scriptName('stress:enqueue-missing')
  .option('dry-run', { type: 'boolean', default: false })
  .option('mod-id', { type: 'number' })
  .option('shard', {
    type: 'string',
    describe: 'Process only mods where modId % N === i, format i/N (e.g. 0/6)',
  })
  .option('target-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('src-lang', { type: 'string', default: CONFIG.defaultSrcLang })
  .help()
  .parse();

const parseShard = (raw: string | undefined): { index: number; total: number } | null => {
  if (!raw?.trim()) return null;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(raw.trim());
  if (!m) throw new Error(`Invalid --shard ${raw}; expected i/N`);
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    total < 1 ||
    index < 0 ||
    index >= total
  ) {
    throw new Error(`Invalid --shard ${raw}; need 0 <= i < N`);
  }
  return { index, total };
};

validateConfig();
const db = openDb();
const shard = parseShard(argv.shard as string | undefined);
const srcLang = String(argv['src-lang']).trim();
const targetLang = String(argv['target-lang']).trim().toLowerCase();
const onlyModId = argv['mod-id'] as number | undefined;

const enqueueStressPlace = async (modId: number): Promise<number> => {
  const jobId = await allocateJobId();
  await writeJobSnapshot({
    jobId,
    kind: 'stress-place',
    modId,
    status: 'running',
    done: 0,
    total: 0,
    error: null,
    data: { jobId, modId, placedCount: 0 },
  });
  await enqueueJob(
    {
      kind: 'stress-place',
      modId,
      params: { srcLang, targetLang, scope: 'missing' },
    },
    jobId,
  );
  return jobId;
};

const run = async (): Promise<void> => {
  const { rows: mods } = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM mods
      WHERE ($1::int IS NULL OR id = $1)
      ORDER BY id`,
    [onlyModId ?? null],
  );

  let enqueued = 0;
  let skippedNoWork = 0;
  let skippedBusy = 0;
  let skippedShard = 0;
  let failed = 0;

  for (const mod of mods) {
    if (shard && mod.id % shard.total !== shard.index) {
      skippedShard += 1;
      continue;
    }

    try {
      const active = await findActiveJobIdForMod(['stress-place'], mod.id);
      if (active) {
        skippedBusy += 1;
        log.info(`skip mod_id=${mod.id} — stress-place already active job #${active.jobId}`);
        continue;
      }

      const paths = await loadModImportPaths(db, { modId: mod.id });
      const packages = resolveImportPackages(paths.extractDir, targetLang, paths.pluginPath);
      if (packages.length === 0) {
        skippedNoWork += 1;
        continue;
      }

      const pending = await countStressPlaceWork(
        db,
        mod.id,
        packages,
        srcLang,
        targetLang,
        'missing',
      );
      if (pending <= 0) {
        skippedNoWork += 1;
        continue;
      }

      if (argv['dry-run']) {
        log.info(`[dry-run] would enqueue mod_id=${mod.id} pending=${pending} (${mod.name})`);
        enqueued += 1;
        continue;
      }

      const jobId = await enqueueStressPlace(mod.id);
      enqueued += 1;
      log.info(`Enqueued stress-place #${jobId} mod_id=${mod.id} pending=${pending} (${mod.name})`);
    } catch (err) {
      failed += 1;
      log.warn(`mod_id=${mod.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info(
    `Done shard=${argv.shard ?? 'all'} enqueued=${enqueued} noWork=${skippedNoWork} busy=${skippedBusy} otherShard=${skippedShard} failed=${failed}`,
  );
};

try {
  await run();
} finally {
  await closeJobsQueue();
  await closeDb();
}
