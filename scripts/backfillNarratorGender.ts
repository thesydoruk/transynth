#!/usr/bin/env tsx
/**
 * Detect narrator gender for BOOK/TERM/NOTE narrative records.
 *
 * Usage:
 *   npm run backfill:gender -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod to backfill (default: every mod with pending records)
 *   --force         Re-scan records that were already scanned
 *   --no-llm        Heuristics only (skip LLM for inconclusive rows)
 *   --dry-run       List what would be backfilled and exit
 *
 * Examples:
 *   npm run backfill:gender -- --dry-run
 *   npm run backfill:gender
 *   npm run backfill:gender -- --mod-id 102
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb, type Tx } from '../src/db';
import { log } from '../src/logger';
import { countGenderDetectRecords } from '../src/web/data/queries/narratorGender';
import { runModGenderDetectPipeline } from '../worker/src/jobs/genderDetect/pipeline/runPipeline';

type BackfillTarget = {
  modId: number;
  modName: string;
  game: string;
  pending: number;
};

const listBackfillTargets = async (
  db: Tx,
  opts: { modId?: number; force: boolean; srcLang: string },
): Promise<BackfillTarget[]> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    game: string;
    pending: number;
  }>(
    `SELECT m.id AS mod_id, m.name AS mod_name, m.game,
            count(DISTINCT r.id)::int AS pending
       FROM mods m
       JOIN records r ON r.mod_id = m.id
       JOIN strings s ON s.record_id = r.id AND s.lang = $1
      WHERE s.is_ignored = FALSE
        AND r.signature IN ('BOOK', 'TERM', 'NOTE')
        AND (
          r.path ILIKE '%\\UNAM' OR r.path ILIKE '%\\DESC' OR r.path ILIKE '%\\CNAM'
        )
        ${opts.force ? '' : 'AND r.gender_detect_scanned_at IS NULL'}
        ${opts.modId != null ? 'AND m.id = $2' : ''}
      GROUP BY m.id, m.name, m.game
      HAVING count(DISTINCT r.id) > 0
      ORDER BY m.id`,
    opts.modId != null ? [opts.srcLang, opts.modId] : [opts.srcLang],
  );
  return rows.map((row) => ({
    modId: row.mod_id,
    modName: row.mod_name,
    game: row.game,
    pending: row.pending,
  }));
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:gender')
  .usage('$0 [options]')
  .option('mod-id', {
    type: 'number',
    describe: 'Single mod to backfill (default: every mod with pending records)',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Re-scan records that were already scanned',
  })
  .option('no-llm', {
    type: 'boolean',
    default: false,
    describe: 'Heuristics only (skip LLM for inconclusive rows)',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'List what would be backfilled and exit',
  })
  .help()
  .parse();

validateConfig();

const db = openDb();
const srcLang = CONFIG.defaultSrcLang;
const useLlm = !argv['no-llm'];
const force = argv.force === true;
const modId = argv['mod-id'];

const describe = (target: BackfillTarget): string =>
  `mod_id=${target.modId} "${target.modName}" — ${target.pending} record(s)`;

const run = async (): Promise<void> => {
  const targets = await listBackfillTargets(db, { modId, force, srcLang });

  if (modId != null && targets.length === 0) {
    log.error(`Mod ${modId} has no narrative records to backfill`);
    process.exitCode = 1;
    return;
  }

  if (targets.length === 0) {
    log.info('Every mod with narrative records is already scanned (use --force to re-run)');
    return;
  }

  if (argv['dry-run']) {
    log.info(`${targets.length} mod(s) would be backfilled:`);
    for (const target of targets) log.info(`  ${describe(target)}`);
    return;
  }

  let failed = 0;
  for (const target of targets) {
    log.info(`Backfilling ${describe(target)} (useLlm=${useLlm}, force=${force})`);
    try {
      const total = await countGenderDetectRecords(db, target.modId, srcLang, force);
      if (total === 0) {
        log.info('  — nothing pending, skipping');
        continue;
      }

      let lastPct = -1;
      const summary = await runModGenderDetectPipeline(
        db,
        {
          modId: target.modId,
          srcLang,
          modName: target.modName,
          game: target.game,
          useLlm,
          force,
          knownTotal: total,
        },
        {
          onProgress: ({ done, total: t, resolvedCount }) => {
            const pct = t > 0 ? Math.floor((done / t) * 100) : 100;
            if (pct >= lastPct + 10 || done === t) {
              lastPct = pct;
              log.info(`  … ${done}/${t} scanned, ${resolvedCount} gender resolved`);
            }
          },
        },
      );
      log.info(`  ✓ ${summary.done} scanned, ${summary.resolvedCount} gender resolved`);
    } catch (err) {
      failed += 1;
      log.error(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log.info(`Done: ${targets.length - failed}/${targets.length} mod(s) backfilled`);
  if (failed > 0) process.exitCode = 1;
};

try {
  await run();
} finally {
  await closeDb();
}
