#!/usr/bin/env tsx
/**
 * Batch-scan a flat mod directory and import every plugin/archive into the database.
 *
 * Only files directly in the given folder are considered — subdirectories are not walked.
 * Reuses the same registration and import pipeline as the web UI.
 *
 * Usage:
 *   npm run scan:mods -- --dir "D:\Games\Fallout4\Data" --game fo4
 *   npm run scan:mods -- --dir ./mods --game sse --src-lang en --tgt-lang uk
 */
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import type { GameType } from '../src/types';
import { sha1Hex } from '../src/utils/hash';
import {
  listModFilesInDirectory,
  registerArchiveFile,
  registerPluginFile,
  restartModImportJob,
  runModImport,
} from '../src/web/modImportService';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('scan:mods')
  .usage('$0 --dir <path> [options]')
  .option('dir', {
    type: 'string',
    demandOption: true,
    describe: 'Directory containing mod plugins/archives (non-recursive scan)',
  })
  .option('game', {
    type: 'string',
    default: 'fo4',
    choices: [...GAME_CHOICES],
    describe: 'Target game for ESP parsing rules',
  })
  .option('src-lang', {
    type: 'string',
    default: CONFIG.defaultSrcLang,
    describe: 'Source language code stored on import jobs',
  })
  .option('tgt-lang', {
    type: 'string',
    default: CONFIG.defaultTgtLang,
    describe: 'Target translation language code',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Re-import mods whose jobs are already completed',
  })
  .help()
  .parse();

const scanDir = path.resolve(argv.dir);
const game = isGameType(argv.game) ? argv.game : 'fo4';
const srcLang = argv['src-lang'];
const tgtLang = argv['tgt-lang'];
const force = argv.force;

if (!fs.existsSync(scanDir)) {
  log.error(`Directory not found: ${scanDir}`);
  process.exit(1);
}

const stat = fs.statSync(scanDir);
if (!stat.isDirectory()) {
  log.error(`Not a directory: ${scanDir}`);
  process.exit(1);
}

const candidates = listModFilesInDirectory(scanDir);
if (candidates.length === 0) {
  log.warn(`No .esp/.esm/.esl plugins or .zip/.7z/.rar archives found in ${scanDir}`);
  process.exit(0);
}

const extractRoot = path.join(scanDir, '.transynth-extracted');
fs.mkdirSync(extractRoot, { recursive: true });

const db = openDb();
let imported = 0;
let skipped = 0;
let failed = 0;

log.info(`Scanning ${candidates.length} mod file(s) in ${scanDir} (game=${game}, non-recursive)`);

try {
  for (const candidate of candidates) {
    const label = candidate.fileName;

    try {
      let job;
      if (candidate.kind === 'plugin') {
        job = await registerPluginFile(db, candidate.fileName, candidate.filePath, srcLang, tgtLang, game);
      } else {
        const buf = fs.readFileSync(candidate.filePath);
        const fileHash = sha1Hex(buf);
        const outDir = path.join(extractRoot, fileHash);
        job = await registerArchiveFile(
          db,
          candidate.fileName,
          candidate.filePath,
          outDir,
          srcLang,
          tgtLang,
          game,
        );
      }

      if (job.status === 'completed' && !force) {
        log.info(`Skip "${label}" — already imported (job #${job.id}, mod_id=${job.mod_id ?? 'n/a'})`);
        skipped++;
        continue;
      }

      if (job.status === 'completed' && force) {
        await restartModImportJob(db, job.id);
        job = { ...job, status: 'pending', imported_records: 0 };
      }

      log.info(`Importing "${label}" (job #${job.id}, ${job.total_records} ESP rows)...`);
      const result = await runModImport(db, job, (done, total) => {
        if (total > 0 && done % 5000 === 0) {
          log.info(`  "${label}": ${done}/${total}`);
        }
      });

      if (result.status === 'completed') {
        log.info(`Done "${label}" — ${result.imported_records} records (mod_id=${result.mod_id ?? 'n/a'})`);
        imported++;
      } else {
        log.warn(`Finished "${label}" with status=${result.status} (${result.imported_records} records)`);
        failed++;
      }
    } catch (err) {
      failed++;
      log.error(
        `Failed "${label}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
} finally {
  await closeDb();
}

log.info(`Scan complete: imported=${imported}, skipped=${skipped}, failed=${failed}`);
process.exit(failed > 0 ? 1 : 0);
