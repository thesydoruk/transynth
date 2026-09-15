#!/usr/bin/env tsx
/**
 * SHA-1 backfill for the source voice files a mod ships with.
 *
 * Which mods have any is the plugin's answer, not a table this script names:
 * each game stores its clip index differently — Creation Engine keeps one row
 * per speaker folder × response, Disco one per `.wav` stem — so listing them
 * here meant a UNION that a third engine would have had to be added to.
 *
 * Usage:
 *   npm run voice:backfill-hashes
 *   npm run voice:backfill-hashes -- --workers=8
 *   npm run voice:backfill-hashes -- --mod=33
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { gamePlugin } from '../src/games/registry';
import { loadModImportPaths } from '../src/import/mod/resolvePaths';
import { log } from '../src/logger';
import { resolveVoiceSourceFileHashes } from '../src/voice/voiceSourceFileHashes';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const workers = Math.max(1, Number(arg('workers') ?? 8) || 8);
const onlyModId = arg('mod');

const db = openDb();
try {
  const { rows: allMods } = await db.query<{ id: number; name: string; game: string }>(
    `SELECT m.id, m.name, m.game
       FROM mods m
      WHERE ($1::int IS NULL OR m.id = $1)
      ORDER BY m.id`,
    [onlyModId ? Number(onlyModId) : null],
  );
  // A game with no voice adapter ships no takes to hash.
  const rows = allMods.filter((mod) => gamePlugin(mod.game).voice);

  console.log(`Voice hash backfill: ${rows.length} mod(s), workers=${workers}`);
  let resolvedTotal = 0;

  for (const mod of rows) {
    let paths;
    try {
      paths = await loadModImportPaths(db, { modId: mod.id });
    } catch (err) {
      console.log(
        `Voice hash backfill: #${mod.id} ${mod.name} skip (${err instanceof Error ? err.message : String(err)})`,
      );
      continue;
    }

    const takes = gamePlugin(mod.game).voice?.discoverSourceTakes(paths) ?? [];
    const files = takes.map((file) => ({
      modId: mod.id,
      relPath: file.relPath,
      absPath: file.absolutePath,
    }));

    let lastLogged = 0;
    const started = Date.now();
    const hashes = await resolveVoiceSourceFileHashes(db, files, {
      concurrency: workers,
      onHashed: (done, total) => {
        if (done - lastLogged < 2000 && done !== total) return;
        lastLogged = done;
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(
          `Voice hash backfill: #${mod.id} ${mod.name} hashing ${done}/${total} (${elapsed}s)`,
        );
      },
    });

    resolvedTotal += hashes.size;
    console.log(
      `Voice hash backfill: #${mod.id} ${mod.name} files=${files.length} resolved=${hashes.size} ${((Date.now() - started) / 1000).toFixed(1)}s`,
    );
    log.info(`Voice hash backfill: #${mod.id} ${mod.name} resolved=${hashes.size}`);
  }

  const { rows: totals } = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM voice_source_file_hashes`,
  );
  console.log(
    `Voice hash backfill done: resolved=${resolvedTotal} rows now=${totals[0]?.n ?? '?'} (workers=${workers})`,
  );
} finally {
  await closeDb();
}
