#!/usr/bin/env tsx
/**
 * Import plugin strings that earlier imports skipped, without a full re-import.
 *
 * Needed after the translatable-subrecord config changes: a mod imported before
 * a record type was enabled keeps a hole in its strings, and re-importing it
 * would prune and rebuild every row. This walks each mod's plugin, diffs it
 * against the records already stored, and inserts only what is missing —
 * existing strings and their translations are never touched.
 *
 * Plugin strings only; MCM, PEX and the dialog graph need a full import.
 *
 * Usage:
 *   npm run backfill:strings -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod (default: every mod with a plugin on disk)
 *   --chunk <n>     Rows per bulk insert (default: configured DB chunk size)
 *   --dry-run       Report what is missing per mod and exit
 *
 * Examples:
 *   npm run backfill:strings -- --dry-run
 *   npm run backfill:strings -- --mod-id 33
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { clearBa2Cache } from '../src/formats/ba2';
import { log } from '../src/logger';
import { backfillModStrings, listBackfillTargets } from '../src/import/backfill';
import { withPinnedModImportWriteLock } from '../src/import/locks';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:strings')
  .usage('$0 [options]')
  .option('mod-id', {
    type: 'number',
    describe: 'Single mod to re-scan (default: every mod with a plugin on disk)',
  })
  .option('chunk', {
    type: 'number',
    default: CONFIG.dbChunkSize,
    describe: 'Rows per bulk insert',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Report what is missing per mod and exit',
  })
  .help()
  .parse();

validateConfig();

const db = openDb();
const opts = { dryRun: argv['dry-run'], chunkSize: Math.max(1, argv.chunk) };

const run = async (): Promise<number> => {
  const { targets, skipped } = await listBackfillTargets(db, argv['mod-id']);

  log.info(
    `Backfill scope: ${targets.length} mod(s) with a plugin on disk` +
      (skipped.length > 0 ? `, ${skipped.length} not re-scannable` : '') +
      (opts.dryRun ? ' [dry run]' : ''),
  );
  for (const skip of skipped) {
    log.debug(`  skip mod_id=${skip.modId} "${skip.modName}" — ${skip.reason}`);
  }

  let totalRecords = 0;
  let totalStrings = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const result = await withPinnedModImportWriteLock(db, (client) =>
        backfillModStrings(client, target, opts),
      );
      if (result.missingRecords === 0) continue;

      totalRecords += result.missingRecords;
      totalStrings += result.insertedStrings;
      const breakdown = result.bySignature
        .map((entry) => `${entry.signature}=${entry.records}`)
        .join(', ');

      if (opts.dryRun) {
        log.info(
          `mod_id=${target.modId} "${target.modName}" — ${result.missingRecords} missing record(s): ${breakdown}`,
        );
      } else {
        log.info(
          `mod_id=${target.modId} "${target.modName}" — added ${result.missingRecords} record(s), ` +
            `${result.insertedStrings} string(s), ${result.insertedTranslations} translation(s) ` +
            `[${result.locales.join(', ')}]: ${breakdown}`,
        );
      }

      if (result.dialogRecords > 0) {
        log.warn(
          `mod_id=${target.modId} "${target.modName}" — ${result.dialogRecords} dialog record(s) added; ` +
            'run a full re-import to rebuild the dialog graph for them',
        );
      }
    } catch (err) {
      log.error(
        `mod_id=${target.modId} "${target.modName}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    } finally {
      clearBa2Cache();
    }
  }

  log.info(
    (opts.dryRun ? 'Dry run complete' : 'Backfill complete') +
      `: ${totalRecords} record(s)` +
      (opts.dryRun ? '' : `, ${totalStrings} string(s)`) +
      ` across ${targets.length} mod(s), failed=${failed}`,
  );
  return failed > 0 ? 1 : 0;
};

let exitCode = 0;
try {
  exitCode = await run();
} finally {
  await closeDb();
}
process.exit(exitCode);
