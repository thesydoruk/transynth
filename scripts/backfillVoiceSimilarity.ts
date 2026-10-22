#!/usr/bin/env tsx
/**
 * Score clone similarity for takes that were stamped without one.
 *
 * Synthesis stores the similarity the Fish Speech gateway returns per take; takes
 * made while the gateway could not score, or copied from a donor without a score,
 * have none. This rebuilds each take's reference clips the way synthesis picks them
 * and asks the gateway's /v1/similarity for the number, writing only that column.
 *
 * Usage:
 *   npm run voice:backfill-similarity                 # every mod with takes
 *   npm run voice:backfill-similarity -- --mod=33
 *   npm run voice:backfill-similarity -- --mod=33 --workers=6 --limit=50
 *   npm run voice:backfill-similarity -- --dry-run    # resolve files and references, score nothing
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { gamePlugin } from '../src/games/registry';
import { backfillVoiceSimilarity } from '../src/voice/backfillVoiceSimilarity';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};
const workers = Math.max(1, Number(arg('workers') ?? 4) || 4);
const onlyModId = arg('mod');
const limit = Number(arg('limit') ?? 0) || undefined;
const dryRun = process.argv.includes('--dry-run');

const db = openDb();
try {
  const { rows: mods } = await db.query<{ id: number; name: string; game: string }>(
    `SELECT m.id, m.name, m.game
       FROM mods m
      WHERE ($1::int IS NULL OR m.id = $1)
        AND EXISTS (SELECT 1 FROM voice_synthesis_state v
                     WHERE v.mod_id = m.id AND v.voice_similarity IS NULL)
      ORDER BY m.id`,
    [onlyModId ? Number(onlyModId) : null],
  );
  const voiced = mods.filter((mod) => gamePlugin(mod.game).voice);
  console.log(
    `Voice similarity backfill: ${voiced.length} mod(s), workers=${workers}${dryRun ? ', dry run' : ''}`,
  );
  for (const mod of voiced) {
    const result = await backfillVoiceSimilarity(db, mod.id, {
      workers,
      dryRun,
      limit,
      log: (message) => console.log(message),
    });
    if (result.skipped) {
      console.log(`#${mod.id} ${mod.name}: skipped (${result.reason})`);
      continue;
    }
    console.log(
      `#${mod.id} ${mod.name}: ${result.scored} scored of ${result.candidates}, ${result.missing} missing, ${result.unscored} unscored`,
    );
  }
} finally {
  await closeDb();
}
