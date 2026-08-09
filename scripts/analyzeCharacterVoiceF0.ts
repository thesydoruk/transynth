#!/usr/bin/env tsx
/**
 * Estimate mean F0 for FO4 voice-folder characters from EN dialogue clips.
 * Stores results in `character_voice_profiles` for UK voice auto-mapping.
 *
 * Usage:
 *   npm run voice:analyze-character-f0
 */
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { ensureDataDirs } from '../src/paths';
import { analyzeCharacterVoiceF0 } from '../src/voice/ukLibrary';

ensureDataDirs();
const db = openDb();

try {
  const result = await analyzeCharacterVoiceF0(db);
  log.info(
    `Character F0 finished: analyzed=${result.analyzed}, withF0=${result.withF0}, skipped=${result.skipped}, failed=${result.failed}`,
  );
} catch (err) {
  log.error(err, 'Character F0 analysis failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
