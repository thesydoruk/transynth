import type { Tx } from '../../db';

export type CharacterVoiceProfile = {
  characterKey: string;
  meanF0Hz: number | null;
  sampleCount: number;
  analyzedAt: string | null;
  meta: Record<string, unknown>;
};

type ProfileDbRow = {
  character_key: string;
  mean_f0_hz: number | null;
  sample_count: number;
  analyzed_at: Date | string | null;
  meta: Record<string, unknown> | null;
};

const toProfile = (row: ProfileDbRow): CharacterVoiceProfile => ({
  characterKey: row.character_key,
  meanF0Hz: row.mean_f0_hz,
  sampleCount: row.sample_count,
  analyzedAt: row.analyzed_at ? new Date(row.analyzed_at).toISOString() : null,
  meta: row.meta ?? {},
});

/** Load all stored character pitch profiles. */
export const listCharacterVoiceProfiles = async (
  db: Tx,
): Promise<Map<string, CharacterVoiceProfile>> => {
  const { rows } = await db.query<ProfileDbRow>(
    `SELECT character_key, mean_f0_hz, sample_count, analyzed_at, meta
     FROM character_voice_profiles`,
  );
  return new Map(rows.map((row) => [row.character_key, toProfile(row)]));
};

/** Upsert F0 analysis for one voice-folder character. */
export const upsertCharacterVoiceProfile = async (
  db: Tx,
  profile: {
    characterKey: string;
    meanF0Hz: number | null;
    sampleCount: number;
    meta?: Record<string, unknown>;
  },
): Promise<void> => {
  await db.query(
    `INSERT INTO character_voice_profiles(character_key, mean_f0_hz, sample_count, analyzed_at, meta)
     VALUES ($1, $2, $3, NOW(), $4::jsonb)
     ON CONFLICT (character_key) DO UPDATE SET
       mean_f0_hz = EXCLUDED.mean_f0_hz,
       sample_count = EXCLUDED.sample_count,
       analyzed_at = NOW(),
       meta = EXCLUDED.meta`,
    [
      profile.characterKey,
      profile.meanF0Hz,
      profile.sampleCount,
      JSON.stringify(profile.meta ?? {}),
    ],
  );
};
