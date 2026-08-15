#!/usr/bin/env tsx
/**
 * Backfill Disco signatures (DLG/GEN/FX) and speakers for already-imported mods.
 *
 * Usage:
 *   npm run backfill:disco-metadata -- [options]
 *
 * Options:
 *   --mod-id <id>   Single disco mod (default: every disco mod with an extract)
 *   --dry-run       Count updates only
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  backfillDiscoMetadataForMod,
  listDiscoModsForMetadataBackfill,
} from '../src/import/mod/backfillDiscoMetadata';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:disco-metadata')
  .option('mod-id', { type: 'number', describe: 'Single disco mod to backfill' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

const db = openDb();

try {
  const targets = await listDiscoModsForMetadataBackfill(db, argv['mod-id']);
  if (targets.length === 0) {
    log.info('No Disco mods with an extract dir were found.');
    process.exit(0);
  }

  let failed = 0;
  for (const target of targets) {
    try {
      const result = await backfillDiscoMetadataForMod(db, target, { dryRun: argv['dry-run'] });
      log.info(
        `Mod ${result.modId} (${result.name}): scanned=${result.scanned} signatures=${result.signaturesUpdated} speakers=${result.speakers}${argv['dry-run'] ? ' [dry-run]' : ''}`,
      );
    } catch (err) {
      failed += 1;
      log.error(
        `Mod ${target.id} (${target.name}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (failed > 0) process.exit(1);
  log.info(`Done: ${targets.length - failed}/${targets.length} mod(s)`);
} finally {
  await closeDb(db);
}
