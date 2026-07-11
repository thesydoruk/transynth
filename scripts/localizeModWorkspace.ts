#!/usr/bin/env tsx
/**
 * Export database translations into `localize/` under a mod import extract tree.
 *
 * Usage:
 *   npm run mod:localize -- --job-id <id> [options]
 *   npm run mod:localize -- --mod-id <id> [options]
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { localizeModImport } from '../src/modWorkspace/localizeModWorkspace';
import type { GameType } from '../src/types';
import { loadModImportPaths } from '../src/web/import/resolveModImportPaths';

const GAME_CHOICES = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'] as const;

const isGameType = (value: string): value is GameType => {
  return (GAME_CHOICES as readonly string[]).includes(value);
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('mod:localize')
  .usage('$0 --job-id <id> | --mod-id <id> [options]')
  .option('job-id', {
    type: 'number',
    describe: 'mod_imports job id',
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

  const result = await localizeModImport(db, {
    extractDir: paths.extractDir,
    pluginPath: paths.pluginPath,
    modId: paths.modId ?? argv['mod-id'],
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
