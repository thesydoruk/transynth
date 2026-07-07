#!/usr/bin/env tsx
/**
 * Create a per-mod working directory: copy the mod to `source/` and fully unpack to `extracted/`.
 *
 * Layout:
 *   workingDir/
 *     modName/
 *       source/     — full copy of the mod (folder or archive as-is)
 *       extracted/  — unpacked mod (BA2/BSA extracted to loose files)
 *       output/     — packed .7z archives (npm run mod:pack)
 *
 * When the mod contains multiple ESP/ESM/ESL plugins, `extracted/` gets one subfolder per plugin
 * with that plugin, its companion archives, and matching loose STRINGS files.
 *
 * Usage:
 *   npm run mod:prepare -- --mod <path> --working-dir <path> [options]
 *
 * Required:
 *   --mod <path>           Path to a mod folder or .zip/.7z/.rar archive
 *   --working-dir <path>   Workspace root (default: MOD_WORKING_DIR from .env)
 *
 * Options:
 *   --name <string>        Folder name under working-dir (default: mod file/folder name)
 *   --game <id>            Game rules for companion archive matching (default: fo4)
 *   --force                Overwrite an existing workspace for this mod
 *
 * Examples:
 *   npm run mod:prepare -- --mod "D:\Mods\MyMod.7z" --working-dir "D:\Work\mods"
 *   npm run mod:prepare -- --mod "D:\Mods\MyMod" --working-dir "D:\Work\mods" --name MyMod_UA
 *   npm run mod:prepare -- --mod "D:\Mods\Pack.7z" --working-dir "D:\Work\mods" --game fo4 --force
 */
import '../src/loadEnv';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { prepareModWorkspace } from '../src/modWorkspace/prepareModWorkspace';
import type { GameType } from '../src/types';
import { resolveDirectoryInput } from '../src/utils/file';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const defaultWorkingDir = process.env.MOD_WORKING_DIR?.trim();

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:prepare')
  .usage('$0 --mod <path> --working-dir <path> [options]')
  .option('mod', {
    type: 'string',
    demandOption: true,
    describe: 'Path to a mod folder or .zip/.7z/.rar archive',
  })
  .option('working-dir', {
    type: 'string',
    default: defaultWorkingDir,
    describe: 'Workspace root directory (default: MOD_WORKING_DIR)',
  })
  .option('name', {
    type: 'string',
    describe: 'Folder name under working-dir (default: mod file/folder name)',
  })
  .option('game', {
    choices: [...GAME_CHOICES],
    default: 'fo4' as GameType,
    describe: 'Game for companion BA2/BSA matching',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Overwrite an existing workspace for this mod',
  })
  .check((args) => {
    if (!args['working-dir']?.trim()) {
      throw new Error('Specify --working-dir or set MOD_WORKING_DIR in .env');
    }
    if (!isGameType(args.game)) {
      throw new Error(`Invalid --game value: ${args.game}`);
    }
    return true;
  })
  .help()
  .parse();

const modPath = path.resolve(argv.mod);
const workingDir = resolveDirectoryInput(argv['working-dir']!);

try {
  const result = await prepareModWorkspace({
    modPath,
    workingDir,
    modName: argv.name,
    game: argv.game,
    force: argv.force,
  });

  log.info(`Workspace ready: ${result.workspaceDir}`);
  log.info(`  source:    ${result.sourceDir}`);
  log.info(`  extracted: ${result.extractedDir}`);
  log.info(`  plugins:   ${result.pluginCount}`);
} catch (err) {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
