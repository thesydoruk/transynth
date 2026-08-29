#!/usr/bin/env tsx
/**
 * Re-extract SCEN actions for already-imported mods.
 *
 * Does not reimport the plugin and does not touch translations.
 *
 * Usage:
 *   npm run backfill:scenes -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod (default: every completed FO4/FO76/SSE import)
 *   --dry-run       Extract and count only
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { backfillModScenes, listModsForSceneBackfill } from '../src/import/mod/backfillScenes';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:scenes')
  .option('mod-id', { type: 'number', describe: 'Single mod to backfill' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

const db = openDb();

try {
  const targets = await listModsForSceneBackfill(db, argv['mod-id']);
  if (targets.length === 0) {
    log.info('No imported mods with SCEN records were found.');
    process.exit(0);
  }

  let failed = 0;
  for (const target of targets) {
    try {
      const result = await backfillModScenes(db, target, { dryRun: argv['dry-run'] });
      log.info(
        `Mod ${result.modId} (${result.name}): scenes=${result.scenes} actions=${result.actions} ` +
          `phases=${result.phases} timingSensitive=${result.timingSensitive}` +
          `${argv['dry-run'] ? ' [dry-run]' : ''}`,
      );
    } catch (err) {
      failed += 1;
      log.error(
        `Mod ${target.modId} (${target.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (failed > 0) process.exit(1);
  log.info(`Done: ${targets.length - failed}/${targets.length} mod(s)`);
} finally {
  await closeDb();
}
