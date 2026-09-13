#!/usr/bin/env tsx
/**
 * SHA-1 backfill for source voice files listed in `voice_clips` / `disco_voice_clips`.
 *
 * Usage:
 *   npm run voice:backfill-hashes
 *   npm run voice:backfill-hashes -- --workers=8
 *   npm run voice:backfill-hashes -- --mod=33
 */
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { resolveModDirectoryFromPath } from '../src/formats/mcm';
import { loadModImportPaths } from '../src/import/mod/resolvePaths';
import { log } from '../src/logger';
import { pluginRelPath } from '../src/modImport/packages';
import { discoverDiscoVoiceFiles } from '../src/voice/disco/discoverDiscoVoiceFiles';
import { dedupeVoiceFiles, discoverVoiceFiles } from '../src/voice/discoverVoiceFiles';
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
  const { rows } = await db.query<{ id: number; name: string; game: string; clips: string }>(
    `SELECT m.id, m.name, m.game, COUNT(*)::text AS clips
       FROM (
         SELECT mod_id FROM voice_clips
         UNION ALL
         SELECT mod_id FROM disco_voice_clips
       ) c
       JOIN mods m ON m.id = c.mod_id
      WHERE ($1::int IS NULL OR m.id = $1)
      GROUP BY m.id, m.name, m.game
      ORDER BY COUNT(*) DESC, m.id`,
    [onlyModId ? Number(onlyModId) : null],
  );

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

    const files = (
      mod.game === 'disco'
        ? discoverDiscoVoiceFiles(paths.extractDir)
        : (() => {
            const packageDir = resolveModDirectoryFromPath(paths.pluginPath);
            return dedupeVoiceFiles(
              discoverVoiceFiles(packageDir, pluginRelPath(packageDir, paths.pluginPath)),
            );
          })()
    ).map((file) => ({
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
      `Voice hash backfill: #${mod.id} ${mod.name} files=${files.length} resolved=${hashes.size} clips=${mod.clips} ${((Date.now() - started) / 1000).toFixed(1)}s`,
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
