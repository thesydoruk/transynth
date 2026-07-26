#!/usr/bin/env tsx
/**
 * Import QUST / DLBR dialog structure for mods imported before it was tracked.
 *
 * Reads each mod plugin again, writes quest and branch rows, and stamps DIAL
 * ownership onto existing topics without re-importing strings or INFO nodes.
 *
 * Usage:
 *   npm run backfill:structure -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod to backfill (default: every mod that needs it)
 *   --force         Also redo mods that already have branch rows
 *   --dry-run       List what would be backfilled and exit
 *
 * Examples:
 *   npm run backfill:structure -- --dry-run
 *   npm run backfill:structure
 *   npm run backfill:structure -- --mod-id 102 --force
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  backfillModDialogStructure,
  listDialogStructureBackfillTargets,
  type DialogStructureBackfillTarget,
} from '../src/import/dialogStructure';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:structure')
  .usage('$0 [options]')
  .option('mod-id', {
    type: 'number',
    describe: 'Single mod to backfill (default: every mod that needs it)',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Also redo mods that already have branch rows',
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

const describe = (target: DialogStructureBackfillTarget): string =>
  `mod_id=${target.modId} "${target.modName}" — ${target.topics} topic(s), ` +
  `${target.branches} branch(es), ${target.quests} quest(s), plugin=${target.absPath ?? 'unknown'}`;

const run = async (): Promise<void> => {
  const modId = argv['mod-id'];
  const all = await listDialogStructureBackfillTargets(db, !argv.force && modId == null);
  const targets = modId == null ? all : all.filter((target) => target.modId === modId);

  if (modId != null && targets.length === 0) {
    log.error(
      `Mod ${modId} has no dialog topics to backfill (or already has branches without --force)`,
    );
    process.exitCode = 1;
    return;
  }

  if (targets.length === 0) {
    log.info('Every mod with dialog already has branch structure');
    return;
  }

  if (argv['dry-run']) {
    log.info(`${targets.length} mod(s) would be backfilled:`);
    for (const target of targets) log.info(`  ${describe(target)}`);
    return;
  }

  let failed = 0;

  for (const target of targets) {
    log.info(`Backfilling ${describe(target)}`);
    try {
      await db.query('BEGIN');
      const result = await backfillModDialogStructure(db, target);
      await db.query('COMMIT');
      log.info(
        `  ✓ ${result.quests} quest(s), ${result.branches} branch(es), ${result.dialLinks} dial link(s)` +
          (result.deletedQuests > 0 || result.deletedBranches > 0
            ? `; removed ${result.deletedQuests} quest(s), ${result.deletedBranches} branch(es)`
            : ''),
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
