#!/usr/bin/env tsx
/**
 * Batch-scan a directory tree for orphaned STRINGS packs and import them.
 *
 * Orphaned strings live in a `strings/` folder without a matching plugin
 * (`{stem}.esp/.esm/.esl`) in the same mod tree. Files are grouped by stem;
 * each group is imported as a separate mod. Rows are enriched from the plugin
 * so records keep FormID, EDID, and subrecord paths.
 *
 * Usage:
 *   npm run scan:strings -- --dir <path> [options]
 *
 * Required:
 *   --dir <path>              Folder to scan for orphaned strings packs
 *
 * Options:
 *   --plugins-dir <path>      Game Data folder with .esp/.esm for record enrichment
 *                             (required unless plugins are already in the database)
 *   --game <id>               Game stored on imported mod rows (default: fo4)
 *   --force                   Re-import packs whose content hash is already in the DB
 *   --no-recursive            Only inspect the top-level directory
 *
 * Examples:
 *   npm run scan:strings -- --dir "C:\path\F4_UA" --plugins-dir "D:\Games\Fallout4\Data"
 *   npm run scan:strings -- --dir "D:\Mods" --game fo4 --force
 *   npm run scan:strings -- --dir "D:\Mods" --plugins-dir "D:\Data" --no-recursive
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import type { GameType } from '../src/types';
import { resolveDirectoryInput } from '../src/utils/file';
import { discoverStringsPacks, importStringsPack } from '../src/web/stringsPackImport';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('scan:strings')
  .usage('$0 --dir <path> [options]')
  .option('dir', {
    type: 'string',
    demandOption: true,
    describe: 'Directory to scan for orphaned strings packs (recursive)',
  })
  .option('game', {
    type: 'string',
    default: 'fo4',
    choices: [...GAME_CHOICES],
    describe: 'Target game stored on imported mod rows',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Re-import packs whose content hash is already in the database',
  })
  .option('plugins-dir', {
    type: 'string',
    describe:
      'Game Data folder with .esp/.esm plugins for record enrichment (required unless plugins are already in DB)',
  })
  .option('recursive', {
    type: 'boolean',
    default: true,
    describe: 'Walk subfolders when scanning (disable with --no-recursive)',
  })
  .help()
  .parse();

ensureDataDirs();

const scanDir = resolveDirectoryInput(argv.dir);
const game = isGameType(argv.game) ? argv.game : 'fo4';
const force = argv.force;
const recursive = argv.recursive;
const pluginSearchDirs = argv['plugins-dir']
  ? [resolveDirectoryInput(argv['plugins-dir']), scanDir]
  : [scanDir];

let scanStat: fs.Stats;
try {
  scanStat = fs.statSync(scanDir);
} catch (err) {
  const code =
    err instanceof Error && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
  log.error(`Cannot access directory "${scanDir}"${code ? ` (${code})` : ''}.`);
  process.exit(1);
}

if (!scanStat.isDirectory()) {
  log.error(`Not a directory: ${scanDir}`);
  process.exit(1);
}

const packs = discoverStringsPacks(scanDir, recursive);
if (packs.length === 0) {
  log.warn(`No orphaned strings packs found under ${scanDir}`);
  process.exit(0);
}

const db = openDb();

log.info(`Found ${packs.length} strings group(s) under ${scanDir} (game=${game})`);

let imported = 0;
let skipped = 0;
let failed = 0;

try {
  for (const pack of packs) {
    const label = path.relative(scanDir, pack.packRoot) || path.basename(pack.packRoot);
    const modLabel = `${label}/${pack.stem}`;
    const fileCount = pack.files.length;
    const localeCount = new Set(pack.files.map((f) => f.locale)).size;

    try {
      log.info(`Importing "${modLabel}" — ${fileCount} file(s), ${localeCount} locale(s)...`);
      const result = await importStringsPack(db, pack, game, {
        force,
        pluginSearchDirs,
      });

      if (result.skipped) {
        log.info(
          `Skip "${modLabel}" — already imported as "${result.modName}" (mod_id=${result.modId}, ${result.imported} records)`,
        );
        skipped++;
        continue;
      }

      log.info(
        `Done "${modLabel}" — ${result.imported} string(s) from ${path.basename(result.pluginPath)} ` +
          `(mod_id=${result.modId}, name="${result.modName}", locales=${result.locales.join(', ')}, ` +
          `mapped=${result.mappedEntries}, skipped_unmapped=${result.unmappedEntries})`,
      );
      imported++;
    } catch (err) {
      log.error(`Failed "${modLabel}": ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  log.info(`Scan complete: imported=${imported}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
