#!/usr/bin/env tsx
/**
 * Detect gender (F0) and score quality for all UK library reference clips.
 *
 * Usage:
 *   npm run voice:analyze-uk-library
 */
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import { analyzeUkVoiceLibrary } from '../src/voice/ukLibrary';

ensureDataDirs();
const db = openDb();

try {
  const result = await analyzeUkVoiceLibrary(db);
  log.info(
    `UK voice analysis finished: analyzed=${result.analyzed}, genderUpdated=${result.genderUpdated}, failed=${result.failed}`,
  );
} catch (err) {
  log.error(err, 'UK voice analysis failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
