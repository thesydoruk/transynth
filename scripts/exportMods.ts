#!/usr/bin/env tsx
/**
 * Batch-export localized mod releases from the database to a directory tree.
 *
 * Default output layout per mod:
 * - patched ESP with embedded translations (non-localized mods),
 *   or loose STRINGS tables when the mod is localized,
 * - loose patched PEX scripts under Scripts\ (not repacked into archives),
 * - no BA2/BSA archives.
 *
 * Usage:
 *   npm run export:mods -- --out "D:\Output\F4_UA"
 *   npm run export:mods -- --out "D:\Output" --all --tgt-lang uk
 *   npm run export:mods -- --out "D:\Output" --mod-id 1,2,3
 *   npm run export:mods -- --out "D:\Output" --all --force-localized
 *   npm run export:mods -- --out "D:\Output" --all --repack-archives
 *   npm run export:mods -- --out "D:\Output" --all --no-scripts
 */
import '../src/loadEnv';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import type { GameType } from '../src/types';
import { ensureDir, resolveDirectoryInput } from '../src/utils/file';
import {
  exportModRelease,
  listModExportTargets,
  type ModReleaseExportOptions,
} from '../src/web/exportService';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const parseModIds = (raw: string | undefined): number[] | undefined => {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    throw new Error('--mod-id must list one or more positive integers');
  }
  return ids;
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('export:mods')
  .usage('$0 --out <path> [options]')
  .option('out', {
    type: 'string',
    demandOption: true,
    describe: 'Output root directory (one subfolder per mod)',
  })
  .option('all', {
    type: 'boolean',
    default: false,
    describe: 'Export every mod with a completed import job',
  })
  .option('mod-id', {
    type: 'string',
    describe: 'Comma-separated mod database ids to export',
  })
  .option('mod-name', {
    type: 'string',
    describe: 'Exact mod name (must be unique in the database)',
  })
  .option('game', {
    type: 'string',
    choices: [...GAME_CHOICES],
    describe: 'Only export mods for this game (with --all)',
  })
  .option('src-lang', {
    type: 'string',
    describe: 'Source language override (default: per-mod import src_lang or SRC_LANG env)',
  })
  .option('tgt-lang', {
    type: 'string',
    default: CONFIG.defaultTgtLang,
    describe: 'Target translation language code',
  })
  .option('force-localized', {
    type: 'boolean',
    default: false,
    describe: 'Export external STRINGS tables instead of patching the ESP',
  })
  .option('repack-archives', {
    type: 'boolean',
    default: false,
    describe: 'Pack STRINGS (and scripts unless --no-scripts) into BA2/BSA archives',
  })
  .option('no-scripts', {
    type: 'boolean',
    default: false,
    describe: 'Skip Papyrus script localization',
  })
  .option('flat', {
    type: 'boolean',
    default: false,
    describe: 'Write files directly into --out instead of per-mod subfolders',
  })
  .option('parallel', {
    type: 'number',
    default: 1,
    describe: 'Export this many mods concurrently (1–4)',
  })
  .check((args) => {
    const hasTarget = args.all || args['mod-id'] || args['mod-name'];
    if (!hasTarget) {
      throw new Error('Provide --all, --mod-id, or --mod-name');
    }
    if (args.all && (args['mod-id'] || args['mod-name'])) {
      throw new Error('Use either --all or a specific mod selector, not both');
    }
    if (args['mod-id'] && args['mod-name']) {
      throw new Error('Use either --mod-id or --mod-name, not both');
    }
    return true;
  })
  .help()
  .parse();

const clampParallel = (value: number): number => Math.max(1, Math.min(4, value));

ensureDataDirs();

const outRoot = resolveDirectoryInput(argv.out);
const tgtLang = argv['tgt-lang'];
const srcLangOverride = argv['src-lang'];
const exportOptions: ModReleaseExportOptions = {
  forceLocalized: argv['force-localized'],
  repackArchives: argv['repack-archives'],
  localizeScripts: !argv['no-scripts'],
};
const flat = argv.flat;
const parallel = clampParallel(argv.parallel);
const gameFilter = argv.game && isGameType(argv.game) ? argv.game : undefined;

ensureDir(outRoot);

const db = openDb();

type ExportOutcome = 'exported' | 'failed';

const resolveTargets = async () => {
  if (argv['mod-name']) {
    const name = argv['mod-name'].trim();
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM mods WHERE name ILIKE $1 ORDER BY id LIMIT 2`,
      [name],
    );
    if (rows.length === 0) throw new Error(`Mod not found: "${name}"`);
    if (rows.length > 1) throw new Error(`Multiple mods match "${name}" — use --mod-id`);
    return listModExportTargets(db, { modIds: [rows[0]!.id] });
  }

  const modIds = parseModIds(argv['mod-id']);
  return listModExportTargets(db, {
    modIds: argv.all ? undefined : modIds,
    game: gameFilter,
  });
};

try {
  const targets = await resolveTargets();
  if (targets.length === 0) {
    log.warn('No exportable mods found (need completed import and abs_path on disk)');
    process.exit(0);
  }

  log.info(`Exporting ${targets.length} mod(s) → ${outRoot}`);
  log.info(
    `Options: forceLocalized=${exportOptions.forceLocalized}, ` +
      `repackArchives=${exportOptions.repackArchives}, ` +
      `localizeScripts=${exportOptions.localizeScripts}, tgtLang=${tgtLang}`,
  );
  if (parallel > 1) log.info(`Parallel export workers: ${parallel}`);

  let nextIdx = 0;
  let exported = 0;
  let failed = 0;

  const exportOne = async (target: (typeof targets)[number]): Promise<ExportOutcome> => {
    const stem = path.basename(target.modPath, path.extname(target.modPath));
    const modOutDir = flat ? outRoot : path.join(outRoot, stem);
    const srcLang = srcLangOverride ?? target.srcLang;

    try {
      log.info(`Exporting "${target.modName}" (mod_id=${target.modId}) → ${modOutDir}`);
      const result = await exportModRelease(
        db,
        target.modId,
        target.modPath,
        srcLang,
        tgtLang,
        target.game,
        modOutDir,
        exportOptions,
      );
      for (const warning of result.warnings) {
        log.warn(`  ${target.modName}: ${warning}`);
      }
      log.info(`  Done — ${result.files.length} file(s)`);
      return 'exported';
    } catch (err) {
      log.error(
        `Failed "${target.modName}" (mod_id=${target.modId}): ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIdx;
      if (index >= targets.length) break;
      nextIdx = index + 1;
      const outcome = await exportOne(targets[index]!);
      if (outcome === 'exported') exported++;
      else failed++;
    }
  };

  await Promise.all(Array.from({ length: parallel }, () => worker()));

  log.info(`Export complete: exported=${exported}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
