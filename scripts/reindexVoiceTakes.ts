#!/usr/bin/env tsx
/**
 * Re-derive the take index of imported mods whose game infers it from file names.
 *
 * A Disco pack imported before the soundtrack was filtered out, or before
 * transcript alignment existed, carries both problems in the database: rows for
 * music and foley that can never have a line, speakers named after them, and
 * whole conversations without text because one lockit row had no take. This
 * re-reads the pack and then listens to whatever is still unmatched.
 *
 * Usage:
 *   npm run voice:reindex-takes
 *   npm run voice:reindex-takes -- --mod=133
 *   npm run voice:reindex-takes -- --no-audio     # rebuild rows, skip listening
 *   npm run voice:reindex-takes -- --keep-rows    # listen only, no rebuild
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { checkAudioIntelHealth } from '../src/audioIntel/health';
import { findGamePlugin } from '../src/games/registry';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const db = openDb();
try {
  const onlyModId = arg('mod');
  const matchByAudio = !hasFlag('no-audio');
  const rebuild = !hasFlag('keep-rows');
  if (matchByAudio) await checkAudioIntelHealth();

  const { rows } = await db.query<{ id: number; name: string; game: string; abs_path: string }>(
    `SELECT id, name, game, abs_path
       FROM mods
      WHERE abs_path IS NOT NULL
        AND ($1::int IS NULL OR id = $1)
      ORDER BY id`,
    [onlyModId ? Number(onlyModId) : null],
  );

  const targets = rows.flatMap((mod) => {
    const reindex = findGamePlugin(mod.game)?.voice?.reindexTakes;
    return reindex ? [{ mod, reindex }] : [];
  });
  console.log(`Voice take reindex: ${targets.length} mod(s)`);

  for (const { mod, reindex } of targets) {
    try {
      const result = await reindex(db, {
        modId: mod.id,
        pluginPath: mod.abs_path,
        rebuild,
        matchByAudio,
        onProgress: (done, total) => {
          if (done % 500 === 0) console.log(`    transcribed ${done}/${total}`);
        },
      });
      const summary =
        `${result.takes} take(s), ${result.speakers} speaker(s); ` +
        `matched ${result.matched}/${result.unmatched} without a line ` +
        `(${result.transcribed} transcribed)`;
      console.log(`  #${mod.id} ${mod.name}: ${summary}`);
      log.info(`Voice take reindex: #${mod.id} ${summary}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  #${mod.id} ${mod.name}: skipped — ${message}`);
    }
  }
} finally {
  await closeDb();
}
