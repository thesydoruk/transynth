#!/usr/bin/env tsx
/**
 * Re-parse Disco voice_clips.speaker_key from wav stems and rebuild dialog_speakers.
 *
 *   npx tsx scripts/remapDiscoSpeakers.ts
 *   npx tsx scripts/remapDiscoSpeakers.ts --mod=133
 */
import '../src/games';
import '../src/loadEnv';
import { closeDb, openDb } from '../src/db';
import { log } from '../src/logger';
import { persistDiscoSpeakers } from '../src/games/disco-elysium/import/speakers';
import { loadDiscoVoiceClipSummaries } from '../src/games/disco-elysium/voice/loadVoiceClips';

const arg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit?.slice(prefix.length);
};

const db = openDb();
try {
  const onlyModId = arg('mod');
  const { rows } = await db.query<{ id: number; name: string }>(
    `SELECT id, name
       FROM mods
      WHERE game = 'disco'
        AND ($1::int IS NULL OR id = $1)
      ORDER BY id`,
    [onlyModId ? Number(onlyModId) : null],
  );

  console.log(`Disco speaker remap: ${rows.length} mod(s)`);
  log.info(`Disco speaker remap: ${rows.length} mod(s)`);

  for (const mod of rows) {
    const clips = await loadDiscoVoiceClipSummaries(db, mod.id);
    const speakers = await persistDiscoSpeakers(
      db,
      mod.id,
      clips.map((clip) => clip.wavStem),
    );
    const { rows: leftover } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM voice_clips vc
        WHERE vc.mod_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM dialog_speakers sp
             WHERE sp.mod_id = vc.mod_id AND sp.speaker_key = vc.speaker_key
          )`,
      [mod.id],
    );
    console.log(
      `Disco speaker remap: #${mod.id} ${mod.name} → ${speakers} speaker(s), ${clips.length} clip(s), unmatched=${leftover[0]?.n ?? '?'}`,
    );
    log.info(
      `Disco speaker remap: #${mod.id} ${mod.name} → ${speakers} speaker(s), ${clips.length} clip(s)`,
    );
  }
} finally {
  await closeDb();
}
