#!/usr/bin/env tsx
/**
 * Export database translations into a mod workspace `localize/` folder.
 * Only files that differ from the matching path under `extracted/` are written.
 *
 * Layout:
 *   workingDir/
 *     modName/
 *       extracted/  — unpacked mod baseline (comparison source)
 *       localize/   — localized deltas only (output)
 *       manifest.json
 *
 * Usage:
 *   npm run mod:localize -- --workspace <path> [options]
 *   npm run mod:localize -- --working-dir <path> --name <modName> [options]
 *
 * Required (one of):
 *   --workspace <path>     Path to mod workspace folder
 *   --working-dir + --name Workspace root and mod folder name
 *
 * Options:
 *   --mod-id <id>          Database mod id (required when multiple mods share the name)
 *   --src-lang <code>      Source language override
 *   --tgt-lang <code>      Target language (default: TGT_LANG)
 *   --game <id>            Game override (default: manifest or DB)
 *
 * Examples:
 *   npm run mod:localize -- --workspace "D:\Work\mods\MyMod"
 *   npm run mod:localize -- --working-dir "D:\Work\mods" --name MyMod --mod-id 45
 */
import '../src/loadEnv';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { localizeModWorkspace } from '../src/modWorkspace/localizeModWorkspace';
import type { GameType } from '../src/types';
import { resolveDirectoryInput } from '../src/utils/file';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const defaultWorkingDir = process.env.MOD_WORKING_DIR?.trim();

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:localize')
  .usage('$0 --workspace <path> [options]')
  .option('workspace', {
    type: 'string',
    describe: 'Path to mod workspace folder',
  })
  .option('working-dir', {
    type: 'string',
    default: defaultWorkingDir,
    describe: 'Workspace root (with --name)',
  })
  .option('name', {
    type: 'string',
    describe: 'Mod folder name under --working-dir',
  })
  .option('mod-id', {
    type: 'number',
    describe: 'Database mod id',
  })
  .option('src-lang', {
    type: 'string',
    describe: `Source language (default: per-mod import or ${CONFIG.defaultSrcLang})`,
  })
  .option('tgt-lang', {
    type: 'string',
    default: CONFIG.defaultTgtLang,
    describe: 'Target translation language',
  })
  .option('game', {
    choices: [...GAME_CHOICES],
    describe: 'Game override',
  })
  .check((args) => {
    if (args.workspace?.trim()) return true;
    if (args['working-dir']?.trim() && args.name?.trim()) return true;
    throw new Error('Specify --workspace or both --working-dir and --name');
  })
  .help()
  .parse();

const workspaceDir = argv.workspace?.trim()
  ? path.resolve(argv.workspace)
  : path.join(resolveDirectoryInput(argv['working-dir']!), argv.name!);

if (argv.game && !isGameType(argv.game)) {
  log.error(`Invalid --game value: ${argv.game}`);
  process.exit(1);
}

const db = openDb();

try {
  const result = await localizeModWorkspace(db, {
    workspaceDir,
    modId: argv['mod-id'],
    srcLang: argv['src-lang'],
    tgtLang: argv['tgt-lang'],
    game: argv.game as GameType | undefined,
  });

  log.info(
    `Localized "${result.modName}" (id=${result.modId}) → ${result.localizeDir}: ${result.written.length} written, ${result.skipped.length} unchanged`,
  );
  for (const rel of result.written) {
    log.info(`  + ${rel}`);
  }
  for (const warning of result.warnings) {
    log.warn(warning);
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  await closeDb();
}
