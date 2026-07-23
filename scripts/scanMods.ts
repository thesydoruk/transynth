#!/usr/bin/env tsx
/**
 * Batch-scan a mod directory tree and import every plugin/archive into the database.
 *
 * Walks the given folder recursively (skips `.transynth-extracted`, `.git`, `node_modules`).
 * Reuses the same registration and import pipeline as the web UI. Imports ESP rows,
 * STRINGS locales, MCM translations, and PEX script literals.
 *
 * Completed jobs are skipped unless `--force` is set. A full re-import from the
 * beginning removes strings/records that are no longer present in the scan.
 *
 * Network/mapped drives are read-only scan sources. Archives extract to local
 * `DATA_DIR/cache/scan-extract` (override with `SCAN_EXTRACT_DIR`).
 *
 * Usage:
 *   npm run scan:mods -- --dir <path> [options]
 *
 * Required:
 *   --dir <path>        Root folder to scan recursively for .esp/.esm/.esl and archives
 *
 * Options:
 *   --game <id>         Game rules for ESP parsing (default: fo4)
 *                       fo4 | fo76 | fo3 | fnv | ob | mw | sse | sle
 *   --src-lang <code>   Lang tag for non-localized plugins and PEX strings (default: en)
 *   --tgt-lang <code>   Target translation language stored on the job (default: TGT_LANG)
 *   --force             Re-import mods whose jobs are already completed
 *   --parallel <n>      Concurrent imports, 1–8 (default: 1; DB writes serialize via advisory lock)
 *
 * Examples:
 *   npm run scan:mods -- --dir "D:\Games\Fallout4\Data" --game fo4
 *   npm run scan:mods -- --dir "\\nas\share\mods" --game fo4 --parallel 3
 *   npm run scan:mods -- --dir "Z:\Mods" --game fo4 --force
 *   npm run scan:mods -- --dir "Z:\Mods" --force --src-lang en --tgt-lang uk
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { PATHS, ensureDataDirs } from '../src/paths';
import type { GameType } from '../src/types';
import { ensureDir, resolveDirectoryInput } from '../src/utils/file';
import { sha1HexFile } from '../src/utils/hash';
import {
  listModFilesInDirectory,
  MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
  ensureModImportSchema,
  modScanContextFromVortex,
  registerArchiveFile,
  registerPluginFile,
  restartModImportJob,
  runModImport,
} from '../src/web/import/modImport';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

/** True for Windows UNC paths (`\\server\share\...`). */
const isUncPath = (p: string): boolean => process.platform === 'win32' && p.startsWith('\\\\');

/**
 * 7-Zip is unreliable with UNC sources — copy to local staging first.
 * Returns the path to extract from (original or staged copy).
 */
const stageArchiveForExtract = async (archivePath: string, fileHash: string): Promise<string> => {
  if (!isUncPath(archivePath)) return archivePath;

  const staged = path.join(PATHS.scanExtract, 'staging', fileHash, path.basename(archivePath));
  ensureDir(path.dirname(staged));
  if (!fs.existsSync(staged)) {
    log.info(`Staging archive from network share: ${path.basename(archivePath)}`);
    await fs.promises.copyFile(archivePath, staged);
  }
  return staged;
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('scan:mods')
  .usage('$0 --dir <path> [options]')
  .option('dir', {
    type: 'string',
    demandOption: true,
    describe: 'Directory containing mod plugins/archives (recursive scan)',
  })
  .option('game', {
    type: 'string',
    default: 'fo4',
    choices: [...GAME_CHOICES],
    describe: 'Target game for ESP parsing rules',
  })
  .option('src-lang', {
    type: 'string',
    default: MOD_IMPORT_DEFAULT_SOURCE_LOCALE,
    describe:
      'Language tag for non-localized plugins and PEX strings (localized mods import all locales; English is the translation anchor)',
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
  .option('parallel', {
    type: 'number',
    default: 1,
    describe:
      'Import this many mods concurrently (1–8; DB writes are serialized — use 1 for large scans)',
  })
  .help()
  .parse();

const clampParallel = (value: number): number => Math.max(1, Math.min(8, value));

ensureDataDirs();
ensureDir(PATHS.scanExtract);

const scanDir = resolveDirectoryInput(argv.dir);
const game = isGameType(argv.game) ? argv.game : 'fo4';
const srcLang = argv['src-lang'] || MOD_IMPORT_DEFAULT_SOURCE_LOCALE;
const tgtLang = argv['tgt-lang'];
const force = argv.force;
const parallel = clampParallel(argv.parallel);

let scanStat: fs.Stats;
try {
  scanStat = fs.statSync(scanDir);
} catch (err) {
  const code =
    err instanceof Error && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
  log.error(
    `Cannot access directory "${scanDir}"${code ? ` (${code})` : ''}. ` +
      'For network paths use a UNC path in quotes, e.g. --dir "\\\\server\\share\\mods" ' +
      'or a mapped drive letter, e.g. --dir "Z:\\Mods".',
  );
  process.exit(1);
}

if (!scanStat.isDirectory()) {
  log.error(`Not a directory: ${scanDir}`);
  process.exit(1);
}

const candidates = listModFilesInDirectory(scanDir);
if (candidates.length === 0) {
  log.warn(`No .esp/.esm/.esl plugins or .zip/.7z/.rar archives found in ${scanDir}`);
  process.exit(0);
}

/** Local cache for archive extraction — avoids writing temp files to network shares. */
const extractRoot = PATHS.scanExtract;

const db = openDb();
await ensureModImportSchema(db);

log.info(`Scanning ${candidates.length} mod file(s) under ${scanDir} (game=${game}, recursive)`);
log.info(`Archive extract cache: ${extractRoot}`);
log.info(`Parallel import workers: ${parallel}`);
if (parallel > 1) {
  log.warn(
    'parallel > 1 only overlaps file I/O — PostgreSQL bulk writes are serialized; prefer --parallel 1 for large game data scans',
  );
}

type ScanOutcome = 'imported' | 'skipped' | 'failed';

const processCandidate = async (candidate: (typeof candidates)[number]): Promise<ScanOutcome> => {
  const label = path.relative(scanDir, candidate.filePath) || candidate.fileName;

  try {
    const scanMeta = modScanContextFromVortex(candidate.vortex);
    let job;
    if (candidate.kind === 'plugin') {
      job = await registerPluginFile(
        db,
        candidate.fileName,
        candidate.filePath,
        srcLang,
        tgtLang,
        game,
        scanMeta,
      );
    } else {
      const fileHash = await sha1HexFile(candidate.filePath);
      const archivePath = await stageArchiveForExtract(candidate.filePath, fileHash);
      const outDir = path.join(extractRoot, fileHash);
      job = await registerArchiveFile(
        db,
        candidate.fileName,
        archivePath,
        outDir,
        srcLang,
        tgtLang,
        game,
        scanMeta,
      );
    }

    if (job.status === 'completed' && !force) {
      log.info(
        `Skip "${label}" — already imported (job #${job.id}, mod_id=${job.mod_id ?? 'n/a'})`,
      );
      return 'skipped';
    }

    if (job.status === 'completed' && force) {
      await restartModImportJob(db, job.id);
      job = { ...job, status: 'pending', imported_records: 0 };
    }

    log.info(`Importing "${label}" (job #${job.id}, ${job.total_records} ESP rows)...`);
    if (scanMeta?.nexusModId) {
      log.info(
        `  Nexus: ${scanMeta.nexusModId} — ${scanMeta.nexusModName ?? scanMeta.sourceFolder}`,
      );
    }
    const result = await runModImport(db, job, (done, total) => {
      if (total > 0 && done % 5000 === 0) {
        log.info(`  "${label}": ${done}/${total}`);
      }
    });

    if (result.status === 'completed') {
      log.info(
        `Done "${label}" — ${result.imported_records} records (mod_id=${result.mod_id ?? 'n/a'})`,
      );
      return 'imported';
    }

    log.warn(
      `Finished "${label}" with status=${result.status} (${result.imported_records} records)`,
    );
    return 'failed';
  } catch (err) {
    log.error(`Failed "${label}": ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
};

try {
  let nextIdx = 0;
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIdx;
      if (index >= candidates.length) break;
      nextIdx = index + 1;
      const outcome = await processCandidate(candidates[index]!);
      if (outcome === 'imported') imported++;
      else if (outcome === 'skipped') skipped++;
      else failed++;
    }
  };

  await Promise.all(Array.from({ length: parallel }, () => worker()));

  log.info(`Scan complete: imported=${imported}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
