#!/usr/bin/env tsx
/**
 * Import a game's text from a folder on disk — a game install, a folder of
 * mods, one unpacked mod — without packing it into an archive for the upload.
 *
 * The game's plugin decides what the folder holds and which files matter
 * (`import.planFolderImport`). Those files are copied into mod storage
 * (`_extracted_{hash}/`) and imported from there exactly as an uploaded
 * archive would be: the export reads the same copy later, and deleting the mod
 * in the UI removes the copy — never the files in your game folder.
 *
 * Usage:
 *   npm run import:folder -- --game <id> --dir <path> [options]
 *
 * Options:
 *   --game <id>          Game plugin (required; only games that support folder import)
 *   --dir <path>         Folder to read
 *   --name <text>        Mod name for a single-mod import (default: chosen by the game)
 *   --per-mod            Import each subfolder of --dir as a separate mod
 *   --langs <list>       Game language codes to read, e.g. en,pl,ru (default: all present)
 *   --src-lang <code>    Source language (default: en)
 *   --tgt-lang <code>    Target language stored on the job (default: TGT_LANG)
 *   --force              Re-import mods whose jobs are already completed
 *   --dry-run            Stage to a temp folder, report what would be imported, touch no DB
 *
 * Examples (The Witcher 3):
 *   npm run import:folder -- --game w3 --dir "C:\Program Files (x86)\Steam\steamapps\common\The Witcher 3" --langs en,pl,ru --dry-run
 *   npm run import:folder -- --game w3 --dir "C:\Program Files (x86)\Steam\steamapps\common\The Witcher 3" --langs en,pl,ru
 *   npm run import:folder -- --game w3 --dir "D:\Games\The Witcher 3\mods" --per-mod
 *
 * The same files with a different --langs are a different import (and a
 * different mod): the selection is part of what is hashed.
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { openDb, closeDb, type Tx } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import { allGamePlugins, gamePlugin } from '../src/games/registry';
import type { FolderImportFile, FolderImportUnit } from '../src/games/contract';
import { ensureDir, resolveDirectoryInput } from '../src/utils/file';
import { sha1HexFile } from '../src/utils/hash';
import {
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  ensureModImportSchema,
  registerExtractedModDirectory,
  restartModImportJob,
} from '../src/import/mod';
import { runModImport } from '../src/import/mod/run/runImport';
import { ensureModStorageDir, modImportExtractDir } from '../src/modStorage';

/** Only games whose plugin can plan a folder import are offered. */
const FOLDER_GAMES = allGamePlugins()
  .filter((plugin) => plugin.import.planFolderImport)
  .map((plugin) => plugin.id);

const argv = await yargs(hideBin(process.argv))
  .scriptName('import:folder')
  .usage('$0 --game <id> --dir <path> [options]')
  .option('game', { type: 'string', demandOption: true, choices: FOLDER_GAMES })
  .option('dir', { type: 'string', demandOption: true, describe: 'Folder to read' })
  .option('name', { type: 'string', describe: 'Mod name (single-mod import only)' })
  .option('per-mod', { type: 'boolean', default: false, describe: 'One mod per subfolder' })
  .option('langs', { type: 'string', describe: 'Comma-separated game language codes' })
  .option('src-lang', { type: 'string', default: MOD_IMPORT_DEFAULT_SOURCE_LOCALE })
  .option('tgt-lang', { type: 'string', default: CONFIG.defaultTgtLang })
  .option('force', { type: 'boolean', default: false, describe: 'Re-import completed jobs' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Report only; no DB writes' })
  .help()
  .parse();

const plugin = gamePlugin(argv.game);
const planFolderImport = plugin.import.planFolderImport!;

/** Bytes of a file the plugin produces, read once for hashing and staging. */
const produced = new WeakMap<FolderImportFile, Buffer>();
const producedBytes = (file: Extract<FolderImportFile, { read: () => Buffer }>): Buffer => {
  let data = produced.get(file);
  if (!data) {
    data = file.read();
    produced.set(file, data);
  }
  return data;
};

const fileHash = async (file: FolderImportFile): Promise<string> =>
  'absPath' in file
    ? sha1HexFile(file.absPath)
    : crypto.createHash('sha1').update(producedBytes(file)).digest('hex');

const fileSize = (file: FolderImportFile): number =>
  'absPath' in file ? fs.statSync(file.absPath).size : file.size;

/** Content identity: the game, and every file's staged place and bytes. */
const hashUnit = async (unit: FolderImportUnit): Promise<string> => {
  const hash = crypto.createHash('sha1').update(`${plugin.id}
`);
  const files = [...unit.files].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const file of files)
    hash.update(`${file.relPath}:${await fileHash(file)}
`);
  return hash.digest('hex');
};

/** Put a unit's files under `targetDir`, skipping ones already there. */
const stageUnit = (unit: FolderImportUnit, targetDir: string): void => {
  for (const file of unit.files) {
    const target = path.join(targetDir, ...file.relPath.split('/'));
    ensureDir(path.dirname(target));
    if (fs.existsSync(target) && fs.statSync(target).size === fileSize(file)) continue;
    if ('absPath' in file) fs.copyFileSync(file.absPath, target);
    else fs.writeFileSync(target, producedBytes(file));
  }
};

const totalBytes = (unit: FolderImportUnit): number =>
  unit.files.reduce((sum, file) => sum + fileSize(file), 0);

/** Stage into a throwaway folder and ask the plugin what it sees there. */
const reportUnit = (unit: FolderImportUnit): void => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-folder-'));
  try {
    stageUnit(unit, scratch);
    const anchor = plugin.import.selectAnchor(scratch);
    const described = anchor ? plugin.import.describeAnchor(anchor, scratch) : null;
    log.info(
      `"${unit.name}": ${unit.files.length} file(s), ${(totalBytes(unit) / 1048576).toFixed(1)} MiB ` +
        `→ ${described ? `${described.totalRecords} source strings` : 'nothing importable'}`,
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};

const importUnit = async (
  db: Tx,
  unit: FolderImportUnit,
): Promise<'imported' | 'skipped' | 'failed'> => {
  const fileHash = await hashUnit(unit);
  const extractDir = modImportExtractDir(fileHash.slice(0, 16));
  stageUnit(unit, extractDir);

  let job = await registerExtractedModDirectory(db, {
    fileName: unit.name,
    fileHash,
    extractDir,
    srcLang: argv['src-lang'],
    tgtLang: argv['tgt-lang'],
    game: plugin.id,
    scan: { sourceFolder: unit.sourceFolder },
  });

  if (job.status === 'completed' && !argv.force) {
    log.info(
      `Skip "${unit.name}" — already imported (job #${job.id}, mod_id=${job.mod_id ?? 'n/a'})`,
    );
    return 'skipped';
  }
  if (job.status === 'completed') {
    await restartModImportJob(db, job.id);
    job = { ...job, status: 'pending', imported_records: 0 };
  }

  log.info(`Importing "${unit.name}" (job #${job.id}, ${job.total_records} records)...`);
  let lastLogged = 0;
  const result = await runModImport(db, job, (done, total) => {
    if (total > 0 && done - lastLogged >= 10000) {
      lastLogged = done;
      log.info(`  "${unit.name}": ${done}/${total}`);
    }
  });
  if (result.status === 'completed') {
    log.info(
      `Done "${unit.name}" — ${result.imported_records} records (mod_id=${result.mod_id ?? 'n/a'})`,
    );
    return 'imported';
  }
  log.warn(
    `Finished "${unit.name}" with status=${result.status} (${result.imported_records} records)`,
  );
  return 'failed';
};

const dir = resolveDirectoryInput(argv.dir);
if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
  log.error(`Not a directory: ${dir}`);
  process.exit(1);
}

const langs = argv.langs
  ? new Set(
      argv.langs
        .split(',')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean),
    )
  : null;

const units = planFolderImport(dir, {
  perMod: argv['per-mod'],
  langs,
  ...(argv.name ? { name: argv.name } : {}),
});
if (units.length === 0) {
  log.warn(`Nothing ${plugin.catalogue.name} can import under ${dir}`);
  process.exit(0);
}

if (argv['dry-run']) {
  for (const unit of units) reportUnit(unit);
  process.exit(0);
}

ensureDataDirs();
ensureModStorageDir();
const db = openDb();
try {
  await ensureModImportSchema(db);
  const outcomes = { imported: 0, skipped: 0, failed: 0 };
  for (const unit of units) {
    try {
      outcomes[await importUnit(db, unit)]++;
    } catch (err) {
      log.error(`Failed "${unit.name}": ${err instanceof Error ? err.message : String(err)}`);
      outcomes.failed++;
    }
  }
  log.info(
    `Folder import (${plugin.id}): imported=${outcomes.imported}, skipped=${outcomes.skipped}, failed=${outcomes.failed}`,
  );
  process.exitCode = outcomes.failed > 0 ? 1 : 0;
} finally {
  await closeDb();
}
