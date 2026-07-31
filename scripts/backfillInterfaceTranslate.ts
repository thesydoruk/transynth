#!/usr/bin/env tsx
/**
 * Backfill Interface/Translate_*.txt UI strings for mods imported before the
 * native interface import phase existed.
 *
 * Inserts missing UI source rows only — never updates or deletes existing
 * translations.
 *
 * Usage:
 *   npm run backfill:interface -- [options]
 *
 * Options:
 *   --mod-id <id>   Single mod to backfill (default: every mod missing UI rows)
 *   --dry-run       Show counts only
 *
 * Examples:
 *   npm run backfill:interface -- --dry-run
 *   npm run backfill:interface -- --mod-id 33
 */
import '../src/loadEnv';
import fs from 'node:fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  backfillModInterfaceTranslate,
  listModsNeedingInterfaceTranslateBackfill,
} from '../src/import/mod/backfillInterfaceTranslate';
import { resolveModStoredPath } from '../src/modStorage/paths';

const argv = await yargs(hideBin(process.argv))
  .scriptName('backfill:interface')
  .option('mod-id', { type: 'number', describe: 'Single mod to backfill' })
  .option('dry-run', { type: 'boolean', default: false })
  .help()
  .parse();

const db = openDb();

try {
  const modId = argv['mod-id'];
  const targets = await listModsNeedingInterfaceTranslateBackfill(db, modId);

  if (targets.length === 0) {
    log.info(
      modId ? `Mod ${modId} already has UI rows or was not found.` : 'No mods need UI backfill.',
    );
    process.exit(0);
  }

  if (argv['dry-run']) {
    for (const target of targets) {
      const modPath = resolveModStoredPath(target.abs_path);
      if (!fs.existsSync(modPath)) {
        log.warn(`Mod ${target.id} (${target.name}): plugin missing at ${modPath}`);
        continue;
      }
      const preview = await backfillModInterfaceTranslate(db, target.id, modPath, target.game, {
        dryRun: true,
      });
      if (!preview) {
        log.info(`Mod ${target.id} (${target.name}): no Interface/Translate files on disk`);
        continue;
      }
      log.info(
        `Mod ${target.id} (${target.name}): would insert ${preview.insertedRecords} UI row(s), skip ${preview.skippedExisting}`,
      );
    }
    process.exit(0);
  }

  let failed = 0;
  for (const target of targets) {
    const modPath = resolveModStoredPath(target.abs_path);
    if (!fs.existsSync(modPath)) {
      log.error(`Mod ${target.id} (${target.name}): plugin missing at ${modPath}`);
      failed++;
      continue;
    }

    try {
      const result = await backfillModInterfaceTranslate(db, target.id, modPath, target.game);
      if (!result) {
        log.info(`Mod ${target.id} (${target.name}): no Interface/Translate files on disk`);
        continue;
      }
      log.info(
        `Mod ${target.id} (${target.name}): +${result.insertedStrings} UI source string(s), ` +
          `${result.insertedTranslations} locale translation(s) inserted if missing, ` +
          `${result.skippedExisting} skipped`,
      );
    } catch (err) {
      log.error(
        `Mod ${target.id} (${target.name}): ${err instanceof Error ? err.message : String(err)}`,
      );
      failed++;
    }
  }

  log.info(`Done: ${targets.length - failed}/${targets.length} mod(s) backfilled`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
