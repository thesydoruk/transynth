#!/usr/bin/env tsx
/**
 * Pack a mod import extract tree into .7z archives under `_output/{extractName}/`.
 *
 * Usage:
 *   npm run mod:pack -- --job-id <id> [options]
 *   npm run mod:pack -- --mod-id <id> [options]
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { packModImport } from '../src/modWorkspace/packModWorkspace';
import type { GameType } from '../src/types';
import { loadModImportPaths } from '../src/web/import/resolveModImportPaths';
import { closeDb, openDb } from '../src/db';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:pack')
  .usage('$0 --job-id <id> | --mod-id <id> [options]')
  .option('job-id', {
    type: 'number',
    describe: 'mod_imports job id',
  })
  .option('mod-id', {
    type: 'number',
    describe: 'Database mod id',
  })
  .option('game', {
    choices: [...GAME_CHOICES],
    describe: 'Game for manifest fallback',
  })
  .check((args) => {
    if (args['job-id'] != null || args['mod-id'] != null) return true;
    throw new Error('Specify --job-id or --mod-id');
  })
  .help()
  .parse();

if (argv.game && !isGameType(argv.game)) {
  log.error(`Invalid --game value: ${argv.game}`);
  process.exit(1);
}

const db = openDb();

try {
  const paths = await loadModImportPaths(db, {
    jobId: argv['job-id'],
    modId: argv['mod-id'],
  });

  const result = await packModImport({
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    modName: paths.fileName.replace(/\.(esp|esm|esl|zip|7z|rar)$/i, ''),
    game: (argv.game as GameType | undefined) ?? paths.game,
    outputDir: paths.packOutputDir,
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
} finally {
  await closeDb();
}
