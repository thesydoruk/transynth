#!/usr/bin/env tsx
/**
 * Persist Bethesda `voice_clips` + `strings.voice_variant` for imported mods.
 *
 * Usage:
 *   npm run voice:backfill-clips
 *   npm run voice:backfill-clips -- --mod=12
 *   npm run voice:backfill-clips -- --hash
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { CONFIG } from '../src/config';
import { log } from '../src/logger';
import { persistBethesdaVoiceClips } from '../src/voice/persistBethesdaVoiceClips';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const db = openDb();
try {
  const onlyModId = arg('mod');
  const hashSourceFiles = hasFlag('hash');
  const { rows } = await db.query<{
    id: number;
    name: string;
    game: string;
    src_lang: string | null;
  }>(
    `SELECT m.id, m.name, COALESCE(m.game, 'fo4') AS game,
            (
              SELECT mi.src_lang
              FROM mod_imports mi
              WHERE mi.mod_id = m.id AND mi.status = 'completed'
              ORDER BY mi.updated_at DESC
              LIMIT 1
            ) AS src_lang
       FROM mods m
      WHERE COALESCE(m.game, 'fo4') <> 'disco'
        AND ($1::int IS NULL OR m.id = $1)
      ORDER BY m.id`,
    [onlyModId ? Number(onlyModId) : null],
  );

  console.log(`Voice clip backfill: ${rows.length} Bethesda mod(s), hash=${hashSourceFiles}`);
  log.info(`Voice clip backfill: ${rows.length} Bethesda mod(s), hash=${hashSourceFiles}`);
  let clips = 0;
  let variants = 0;
  for (const mod of rows) {
    const srcLang = mod.src_lang?.trim() || CONFIG.defaultSrcLang;
    const result = await persistBethesdaVoiceClips(db, mod.id, srcLang, { hashSourceFiles });
    clips += result.clips;
    variants += result.variants;
    console.log(
      `Voice clip backfill: #${mod.id} ${mod.name} → ${result.variants} variant(s), ${result.clips} clip(s)`,
    );
    log.info(
      `Voice clip backfill: #${mod.id} ${mod.name} → ${result.variants} variant(s), ${result.clips} clip(s)`,
    );
  }
  const { rows: totals } = await db.query<{ clips: string; variants: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM voice_clips) AS clips,
       (SELECT COUNT(*)::text FROM strings WHERE voice_variant IS NOT NULL) AS variants`,
  );
  console.log(
    `Voice clip backfill done: wrote ${variants} variant(s), ${clips} clip(s); db now ${totals[0]?.variants ?? '?'} variant(s), ${totals[0]?.clips ?? '?'} clip(s)`,
  );
  log.info(`Voice clip backfill done: ${variants} variant(s), ${clips} clip(s)`);
} finally {
  await closeDb();
}
