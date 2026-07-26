#!/usr/bin/env tsx
/**
 * Resolve speaker and addressee gender for mods imported before it was tracked.
 *
 * Reads each mod's plugin again for its actor records and voice folders, fills
 * `dialog_nodes.speaker_key` plus the addressee columns, and writes the
 * `dialog_speakers` table. Manual gender overrides are preserved.
 *
 * Usage:
 *   npm run backfill:speakers -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod to backfill (default: every mod that needs it)
 *   --force         Also redo mods that already have a speaker table
 *   --dry-run       List what would be backfilled and exit
 *
 * Examples:
 *   npm run backfill:speakers -- --dry-run
 *   npm run backfill:speakers
 *   npm run backfill:speakers -- --mod-id 102 --force
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  backfillModDialogSpeakers,
  listDialogSpeakerBackfillTargets,
  loadPluginPathByBasename,
  type DialogSpeakerBackfillTarget,
} from '../src/import/dialogSpeakers';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:speakers')
  .usage('$0 [options]')
  .option('mod-id', {
    type: 'number',
    describe: 'Single mod to backfill (default: every mod that needs it)',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Also redo mods that already have a speaker table',
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

const describe = (target: DialogSpeakerBackfillTarget): string =>
  `mod_id=${target.modId} "${target.modName}" — ${target.nodes} node(s), ` +
  `${target.speakers} speaker(s), plugin=${target.absPath ?? 'unknown'}`;

const run = async (): Promise<void> => {
  const modId = argv['mod-id'];
  const all = await listDialogSpeakerBackfillTargets(db, !argv.force && modId == null);
  const targets = modId == null ? all : all.filter((target) => target.modId === modId);

  if (modId != null && targets.length === 0) {
    log.error(`Mod ${modId} has no dialog nodes to backfill`);
    process.exitCode = 1;
    return;
  }

  if (targets.length === 0) {
    log.info('Every mod with dialog already has a speaker table');
    return;
  }

  if (argv['dry-run']) {
    log.info(`${targets.length} mod(s) would be backfilled:`);
    for (const target of targets) log.info(`  ${describe(target)}`);
    return;
  }

  let failed = 0;
  const storedByBasename = await loadPluginPathByBasename(db);
  const backfillOpts = {
    storedByBasename,
    resetOverrides: argv.force === true,
  };

  for (const target of targets) {
    log.info(`Backfilling ${describe(target)}`);
    try {
      await db.query('BEGIN');
      const result = await backfillModDialogSpeakers(db, target, backfillOpts);
      await db.query('COMMIT');
      log.info(
        `  ✓ ${result.keyedNodes} node(s) keyed, ${result.speakers} speaker(s), ` +
          `${result.withGender} with a known gender`,
      );
    } catch (err) {
      await db.query('ROLLBACK');
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
