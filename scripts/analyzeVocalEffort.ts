#!/usr/bin/env tsx
/**
 * Measure the vocal effort of a mod's original takes and store which lines get
 * an effort tag (`[shouting]`, `[loud]`).
 *
 * Decodes each take once, so the first run over a base game takes a while; a
 * later run measures only new takes and decides again for all. Synthesis is not
 * touched: tags take effect only for a game that has them switched on in
 * Settings → Voice, and then only the lines that gained a tag become stale.
 * Measurements are saved every few hundred takes: an interrupted run continues
 * where it stopped when started again. The Mods page runs the same analysis as
 * a job (voice menu → Analyze vocal effort).
 *
 * Usage:
 *   npm run voice:analyze-effort -- --mod=33
 *   npm run voice:analyze-effort -- --mod=33 --workers=8
 *   npm run voice:analyze-effort -- --mod=33 --force     # measure every take again
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { analyzeModVocalEffort } from '../src/voice/analyzeVocalEffort';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};
const modId = Number(arg('mod'));
if (!Number.isInteger(modId) || modId <= 0) {
  console.error('Usage: npm run voice:analyze-effort -- --mod=ID [--workers=N] [--force]');
  process.exit(1);
}
const workers = Math.max(1, Number(arg('workers') ?? 4) || 4);

const db = openDb();
try {
  const result = await analyzeModVocalEffort(db, modId, {
    workers,
    force: process.argv.includes('--force'),
    log: (message) => console.log(message),
  });
  if (result.skipped) {
    console.log(`#${modId}: skipped (${result.reason})`);
  } else {
    console.log(
      `#${modId}: ${result.takes} takes, ${result.measured} measured now, ${result.failed} failed; ` +
        `${result.speakersWithBaseline} of ${result.speakers} speakers have a baseline; ` +
        `${result.shouting} shouting, ${result.loud} loud`,
    );
  }
} finally {
  await closeDb();
}
