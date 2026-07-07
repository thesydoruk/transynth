#!/usr/bin/env tsx
/**
 * Pack a mod workspace `extracted/` tree into .7z archives under `output/`.
 * Rebuilds BA2/BSA from loose files before creating the 7z (manifest or inferred layout).
 *
 * Layout:
 *   workingDir/
 *     modName/
 *       extracted/  — edited unpacked mod (input)
 *       output/     — packed .7z archives (output, always 7z)
 *       manifest.json — BA2/BSA layout for repacking
 *
 * Usage:
 *   npm run mod:pack -- --workspace <path> [options]
 *   npm run mod:pack -- --working-dir <path> --name <modName> [options]
 *
 * Required (one of):
 *   --workspace <path>     Path to mod workspace folder (contains extracted/)
 *   --working-dir + --name Workspace root and mod folder name
 *
 * Options:
 *   --game <id>            Game from manifest fallback (default: fo4)
 *
 * Examples:
 *   npm run mod:pack -- --workspace "D:\Work\mods\MyMod"
 *   npm run mod:pack -- --working-dir "D:\Work\mods" --name MyMod
 */
import '../src/loadEnv';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { packModWorkspace } from '../src/modWorkspace/packModWorkspace';
import type { GameType } from '../src/types';
import { resolveDirectoryInput } from '../src/utils/file';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const defaultWorkingDir = process.env.MOD_WORKING_DIR?.trim();

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:pack')
  .usage('$0 --workspace <path> [options]')
  .option('workspace', {
    type: 'string',
    describe: 'Path to mod workspace folder (contains extracted/)',
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
  .option('game', {
    choices: [...GAME_CHOICES],
    default: 'fo4' as GameType,
    describe: 'Game for manifest fallback',
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

if (!isGameType(argv.game)) {
  log.error(`Invalid --game value: ${argv.game}`);
  process.exit(1);
}

try {
  const result = await packModWorkspace({
    workspaceDir,
    game: argv.game,
  });

  log.info(`Packed "${result.modName}" → ${result.outputDir}`);
  for (const archive of result.archives) {
    log.info(`  7z: ${archive}`);
  }
  for (const ba of result.bethesdaArchives) {
    log.info(`  ba: ${ba}`);
  }
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
