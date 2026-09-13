#!/usr/bin/env tsx
/**
 * Copy synthesized takes from same-name / overlapping mods into dest mods.
 *
 * Usage:
 *   npx tsx scripts/reuseSynthesizedVoice.ts --mod=149
 *   npx tsx scripts/reuseSynthesizedVoice.ts --mod=145,148,149
 */
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { CONFIG } from '../src/config';
import { reuseSynthesizedVoice } from '../src/voice/reuseSynthesizedVoice';
import { invalidateVoiceListContext } from '../src/web/voice/preview/voiceListContext';

const arg = process.argv.find((value) => value.startsWith('--mod='));
const modIds = (arg?.slice('--mod='.length) ?? '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((id) => Number.isInteger(id) && id > 0);

if (modIds.length === 0) {
  console.error('Usage: npx tsx scripts/reuseSynthesizedVoice.ts --mod=149');
  process.exit(1);
}

const db = openDb();
try {
  for (const modId of modIds) {
    const started = Date.now();
    console.log(`Reuse start mod ${modId} (${CONFIG.defaultTgtLang})`);
    const result = await reuseSynthesizedVoice(db, modId, CONFIG.defaultTgtLang);
    if (result.copied > 0) invalidateVoiceListContext(modId);
    console.log(
      `Reuse done mod ${modId}: copied=${result.copied} skipped=${result.skipped} ${Date.now() - started}ms`,
    );
  }
} finally {
  await closeDb();
}
