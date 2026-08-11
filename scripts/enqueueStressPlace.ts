#!/usr/bin/env tsx
/**
 * Enqueue stress-place jobs for mods with voiced lines.
 *
 *   npx tsx scripts/enqueueStressPlace.ts [--dry-run] [--scope missing|all] [--mod-id N]
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { loadModImportPaths } from '../src/import/mod/resolvePaths';
import { resolveImportPackages } from '../src/modImport';
import {
  countStressPlaceWork,
  type ModStressPlaceScope,
} from '../src/web/data/queries/stressPlacement';
import { allocateJobId, closeJobsQueue, enqueueJob } from '../worker/src/core/queue';
import { writeJobSnapshot } from '../worker/src/core/snapshots';
import { findActiveJobIdForMod } from '../worker/src/api/jobStatus';

const argv = await yargs(hideBin(process.argv))
  .scriptName('stress:enqueue')
  .option('dry-run', { type: 'boolean', default: false })
  .option('mod-id', { type: 'number' })
  .option('scope', {
    type: 'string',
    choices: ['missing', 'all'] as const,
    default: 'missing' as const,
  })
  .option('target-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('src-lang', { type: 'string', default: CONFIG.defaultSrcLang })
  .help()
  .parse();

validateConfig();
const db = openDb();
const srcLang = String(argv['src-lang']).trim();
const targetLang = String(argv['target-lang']).trim().toLowerCase();
const onlyModId = argv['mod-id'] as number | undefined;
const scope = argv.scope as ModStressPlaceScope;

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
      params: { srcLang, targetLang, scope },
    },
    jobId,
  );
  return jobId;
};

const run = async (): Promise<void> => {
  const { rows: mods } = await db.query<{ id: number; name: string }>(
    onlyModId != null
      ? `SELECT id, name FROM mods WHERE id = $1`
      : `SELECT DISTINCT m.id, m.name
           FROM mods m
           JOIN records r ON r.mod_id = m.id
           JOIN strings s ON s.record_id = r.id
           JOIN translations t ON t.src_string_id = s.id
          WHERE t.target_lang = $1
          ORDER BY m.id`,
    onlyModId != null ? [onlyModId] : [targetLang],
  );

  let enqueued = 0;
  let noWork = 0;
  let busy = 0;
  let failed = 0;

  for (const mod of mods) {
    try {
      const active = await findActiveJobIdForMod(['stress-place'], mod.id);
      if (active) {
        busy += 1;
        log.info(`skip mod_id=${mod.id} busy job #${active.jobId}`);
        continue;
      }
      const paths = await loadModImportPaths(db, { modId: mod.id });
      const packages = resolveImportPackages(paths.extractDir, targetLang, paths.pluginPath);
      if (packages.length === 0) {
        noWork += 1;
        continue;
      }
      const work = await countStressPlaceWork(db, mod.id, packages, srcLang, targetLang, scope);
      if (work === 0) {
        noWork += 1;
        continue;
      }
      if (argv['dry-run']) {
        log.info(
          `[dry-run] would enqueue mod_id=${mod.id} scope=${scope} work=${work} (${mod.name})`,
        );
        enqueued += 1;
        continue;
      }
      const jobId = await enqueueStressPlace(mod.id);
      enqueued += 1;
      log.info(`enqueued job #${jobId} mod_id=${mod.id} scope=${scope} work=${work} (${mod.name})`);
    } catch (err) {
      failed += 1;
      log.error(`mod_id=${mod.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info(
    `Done scope=${scope} enqueued=${enqueued} noWork=${noWork} busy=${busy} failed=${failed}`,
  );
};

try {
  await run();
} finally {
  await closeJobsQueue();
  await closeDb();
  // One-shot CLI — don't leave open handles (Redis) blocking docker compose run.
  process.exit(0);
}
