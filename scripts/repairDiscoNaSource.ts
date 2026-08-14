#!/usr/bin/env tsx
/**
 * Fill Disco Elysium source rows that were imported as msgid placeholder `N/A`.
 *
 * Disco Translator writes real English in msgstr for effects / passive checks.
 *
 * Usage:
 *   npm run repair:disco-na -- [options]
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
  listDiscoModsWithExtract,
  repairDiscoNaSourceForMod,
} from '../src/import/mod/repairDiscoNaSource';

const argv = await yargs(hideBin(process.argv))
  .scriptName('repair:disco-na')
  .option('mod-id', { type: 'number', describe: 'Single disco mod to repair' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

const db = openDb();

try {
  const targets = await listDiscoModsWithExtract(db, argv['mod-id']);
  if (targets.length === 0) {
    log.info('No Disco mods with an extract dir were found.');
    process.exit(0);
  }

  let failed = 0;
  for (const target of targets) {
    try {
      const result = await repairDiscoNaSourceForMod(db, target, { dryRun: argv['dry-run'] });
      log.info(
        `${argv['dry-run'] ? 'Would update' : 'Updated'} ${result.updated}/${result.scanned} N/A source row(s) on mod ${target.id} (${target.name})`,
      );
    } catch (err) {
      failed += 1;
      log.error(`Mod ${target.id} (${target.name}):`, err);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
