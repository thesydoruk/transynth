import type pg from 'pg';
import type { Tx } from '../../db';
import { withTransaction } from '../../db';
import type {
  CharacterUkVoiceLink,
  UkVoiceGender,
  UkVoiceLibraryRow,
  UkVoiceSource,
} from './types';

type LibraryDbRow = {
  id: string;
  source: string;
  display_name: string;
  description: string | null;
  gender: string;
  audio_rel_path: string;
  transcript: string;
  license: string;
  duration_sec: number | null;
  meta: Record<string, unknown> | null;
};

type LinkDbRow = {
  character_key: string;
  voice_id: string;
  assign_reason: string | null;
  assigned_by: string;
  assigned_at: Date | string;
};

const mapLibraryRow = (row: LibraryDbRow): UkVoiceLibraryRow => ({
  id: row.id,
  source: row.source as UkVoiceSource,
  displayName: row.display_name,
  description: row.description,
  gender: row.gender as UkVoiceGender,
  audioRelPath: row.audio_rel_path,
  transcript: row.transcript,
  license: row.license,
  durationSec: row.duration_sec,
  meta: row.meta ?? {},
});

export const listUkVoiceLibrary = async (db: Tx): Promise<UkVoiceLibraryRow[]> => {
  const { rows } = await db.query<LibraryDbRow>(
    `SELECT id, source, display_name, description, gender, audio_rel_path,
            transcript, license, duration_sec, meta
     FROM uk_voice_library
     ORDER BY source, gender, display_name, id`,
  );
  return rows.map(mapLibraryRow);
};

export const getUkVoiceById = async (
  db: Tx,
  voiceId: string,
): Promise<UkVoiceLibraryRow | null> => {
  const { rows } = await db.query<LibraryDbRow>(
    `SELECT id, source, display_name, description, gender, audio_rel_path,
            transcript, license, duration_sec, meta
     FROM uk_voice_library WHERE id = $1`,
    [voiceId],
  );
  return rows[0] ? mapLibraryRow(rows[0]) : null;
};

export const upsertUkVoiceLibraryRow = async (db: Tx, row: UkVoiceLibraryRow): Promise<void> => {
  await db.query(
    `INSERT INTO uk_voice_library(
       id, source, display_name, description, gender, audio_rel_path,
       transcript, license, duration_sec, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       source = EXCLUDED.source,
       display_name = EXCLUDED.display_name,
       description = EXCLUDED.description,
       gender = EXCLUDED.gender,
       audio_rel_path = EXCLUDED.audio_rel_path,
       transcript = EXCLUDED.transcript,
       license = EXCLUDED.license,
       duration_sec = EXCLUDED.duration_sec,
       meta = EXCLUDED.meta`,
    [
      row.id,
      row.source,
      row.displayName,
      row.description,
      row.gender,
      row.audioRelPath,
      row.transcript,
      row.license,
      row.durationSec,
      JSON.stringify(row.meta),
    ],
  );
};

export const getCharacterUkVoiceLink = async (
  db: Tx,
  characterKey: string,
): Promise<CharacterUkVoiceLink | null> => {
  const { rows } = await db.query<LinkDbRow>(
    `SELECT character_key, voice_id, assign_reason, assigned_by, assigned_at
     FROM character_uk_voices WHERE character_key = $1`,
    [characterKey],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    characterKey: row.character_key,
    voiceId: row.voice_id,
    assignReason: row.assign_reason,
    assignedBy: row.assigned_by,
    assignedAt: new Date(row.assigned_at).toISOString(),
  };
};

export const listCharacterUkVoiceLinks = async (db: Tx): Promise<CharacterUkVoiceLink[]> => {
  const { rows } = await db.query<LinkDbRow>(
    `SELECT character_key, voice_id, assign_reason, assigned_by, assigned_at
     FROM character_uk_voices ORDER BY character_key`,
  );
  return rows.map((row) => ({
    characterKey: row.character_key,
    voiceId: row.voice_id,
    assignReason: row.assign_reason,
    assignedBy: row.assigned_by,
    assignedAt: new Date(row.assigned_at).toISOString(),
  }));
};

export const setCharacterUkVoiceLink = async (
  db: Tx,
  characterKey: string,
  voiceId: string,
  opts: { reason?: string | null; assignedBy?: string } = {},
): Promise<void> => {
  await db.query(
    `INSERT INTO character_uk_voices(character_key, voice_id, assign_reason, assigned_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (character_key) DO UPDATE SET
       voice_id = EXCLUDED.voice_id,
       assign_reason = EXCLUDED.assign_reason,
       assigned_by = EXCLUDED.assigned_by,
       assigned_at = NOW()`,
    [characterKey, voiceId, opts.reason ?? null, opts.assignedBy ?? 'manual'],
  );
};

export const clearCharacterUkVoiceLink = async (db: Tx, characterKey: string): Promise<boolean> => {
  const result = await db.query(`DELETE FROM character_uk_voices WHERE character_key = $1`, [
    characterKey,
  ]);
  return (result.rowCount ?? 0) > 0;
};

export const replaceCharacterUkVoiceLinks = async (
  pool: pg.Pool,
  links: Array<{ characterKey: string; voiceId: string; reason: string }>,
): Promise<void> => {
  await withTransaction(pool, async (client) => {
    await client.query(`DELETE FROM character_uk_voices`);
    for (const link of links) {
      await setCharacterUkVoiceLink(client, link.characterKey, link.voiceId, {
        reason: link.reason,
        assignedBy: 'auto',
      });
    }
  });
};
