#!/usr/bin/env tsx
/**
 * Delete all synthesized voice files and reset synthesis version tracking.
 *
 * Usage:
 *   npm run voice:clear
 */
import '../src/loadEnv';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { clearGeneratedVoice } from '../src/voice/clearGeneratedVoice';

const db = openDb();
try {
  const result = await clearGeneratedVoice(db);
  log.info('Generated voice cleared', result);
} finally {
  await closeDb();
}
