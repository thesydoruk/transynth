import type pg from 'pg';
import type { Tx } from '../../db';
import { withTransaction } from '../../db';
import type { UkVoiceAge } from './ageBand';
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
  age: string | null;
  audio_rel_path: string;
  transcript: string;
  license: string;
  duration_sec: number | null;
  quality_score: number | null;
  gender_source: string | null;
  mean_f0_hz: number | null;
  analyzed_at: Date | string | null;
  speaker_key: string | null;
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
  age: (row.age as UkVoiceAge | null) ?? 'unknown',
  audioRelPath: row.audio_rel_path,
  transcript: row.transcript,
  license: row.license,
  durationSec: row.duration_sec,
  qualityScore: row.quality_score,
  genderSource: row.gender_source,
  meanF0Hz: row.mean_f0_hz,
  analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
  speakerKey: row.speaker_key,
  meta: row.meta ?? {},
});

const LIBRARY_SELECT = `SELECT id, source, display_name, description, gender, age, audio_rel_path,
            transcript, license, duration_sec, quality_score, gender_source, mean_f0_hz,
            analyzed_at, speaker_key, meta
     FROM uk_voice_library`;

export const listUkVoiceLibrary = async (db: Tx): Promise<UkVoiceLibraryRow[]> => {
  const { rows } = await db.query<LibraryDbRow>(
    `${LIBRARY_SELECT}
     ORDER BY quality_score DESC NULLS LAST, source, gender, display_name, id`,
  );
  return rows.map(mapLibraryRow);
};

export const getUkVoiceById = async (
  db: Tx,
  voiceId: string,
): Promise<UkVoiceLibraryRow | null> => {
  const { rows } = await db.query<LibraryDbRow>(`${LIBRARY_SELECT} WHERE id = $1`, [voiceId]);
  return rows[0] ? mapLibraryRow(rows[0]) : null;
};

export const upsertUkVoiceLibraryRow = async (db: Tx, row: UkVoiceLibraryRow): Promise<void> => {
  await db.query(
    `INSERT INTO uk_voice_library(
       id, source, display_name, description, gender, age, audio_rel_path,
       transcript, license, duration_sec, quality_score, gender_source, mean_f0_hz,
       analyzed_at, speaker_key, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       source = EXCLUDED.source,
       display_name = EXCLUDED.display_name,
       description = EXCLUDED.description,
       gender = EXCLUDED.gender,
       age = EXCLUDED.age,
       audio_rel_path = EXCLUDED.audio_rel_path,
       transcript = EXCLUDED.transcript,
       license = EXCLUDED.license,
       duration_sec = EXCLUDED.duration_sec,
       quality_score = EXCLUDED.quality_score,
       gender_source = EXCLUDED.gender_source,
       mean_f0_hz = EXCLUDED.mean_f0_hz,
       analyzed_at = EXCLUDED.analyzed_at,
       speaker_key = EXCLUDED.speaker_key,
       meta = EXCLUDED.meta`,
    [
      row.id,
      row.source,
      row.displayName,
      row.description,
      row.gender,
      row.age,
      row.audioRelPath,
      row.transcript,
      row.license,
      row.durationSec,
      row.qualityScore,
      row.genderSource,
      row.meanF0Hz,
      row.analyzedAt,
      row.speakerKey,
      JSON.stringify(row.meta),
    ],
  );
};

/** Remove library voices whose ids are not in `keepIds` (after clearing character links). */
export const deleteUkVoicesNotIn = async (db: Tx, keepIds: string[]): Promise<number> => {
  if (keepIds.length === 0) {
    const result = await db.query(`DELETE FROM uk_voice_library`);
    return result.rowCount ?? 0;
  }
  const result = await db.query(`DELETE FROM uk_voice_library WHERE NOT (id = ANY($1::text[]))`, [
    keepIds,
  ]);
  return result.rowCount ?? 0;
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

export const clearAllCharacterUkVoiceLinks = async (db: Tx): Promise<void> => {
  await db.query(`DELETE FROM character_uk_voices`);
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
