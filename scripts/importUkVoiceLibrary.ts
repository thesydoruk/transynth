#!/usr/bin/env tsx
/**
 * Select best-reference clips from the full UK voice cache into uk_voice_library.
 *
 * Usage:
 *   npm run voice:import-uk-library
 *   npm run voice:import-uk-library -- --max-voices 200
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import { runUkVoiceLibraryImport } from '../src/voice/ukLibrary';

const argv = await yargs(hideBin(process.argv))
  .scriptName('voice:import-uk-library')
  .option('max-voices', {
    type: 'number',
    describe: 'Max Common Voice speakers to import (default: all cached speakers)',
  })
  .help()
  .parse();

ensureDataDirs();
const db = openDb();

try {
  const result = await runUkVoiceLibraryImport(db, {
    maxVoices: argv['max-voices'],
  });
  log.info(
    `Ukrainian voice library import done: opentts=${result.opentts}, commonVoice=${result.commonVoice}, removed=${result.removedObsolete}`,
  );
} catch (err) {
  log.error(err, 'Ukrainian voice library import failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
