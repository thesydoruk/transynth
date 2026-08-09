import type { Tx } from '../../db';
import {
  effectiveSpeakerGenderSql,
  parseSpeakerGender,
  resolveGenderFromVoiceTypeName,
  voiceFolderSpeakerKey,
  type SpeakerGender,
} from '../../dialog';
import { inferCharacterAge } from './ageBand';
import type { UkVoiceCharacter, UkVoiceGender } from './types';

type CharacterAggRow = {
  character_key: string;
  display_name: string | null;
  gender_votes: string | null;
  mod_count: number;
  line_count: number;
  linked_voice_id: string | null;
};

const toUkGender = (gender: SpeakerGender): UkVoiceGender => {
  if (gender === 'male' || gender === 'female') return gender;
  return 'unknown';
};

/** Collapse per-mod speaker rows into global voice-folder characters. */
export const listUkVoiceCharacters = async (db: Tx): Promise<UkVoiceCharacter[]> => {
  const voicePrefix = voiceFolderSpeakerKey('');
  const { rows } = await db.query<CharacterAggRow>(
    `WITH folders AS (
       SELECT
         CASE
           WHEN sp.speaker_key LIKE $1 THEN substring(sp.speaker_key FROM ($2)::int)
           WHEN COALESCE(sp.voice_type, '') <> '' THEN sp.voice_type
           ELSE NULL
         END AS character_key,
         sp.display_name,
         ${effectiveSpeakerGenderSql('sp')} AS effective_gender,
         sp.mod_id,
         sp.line_count
       FROM dialog_speakers sp
     )
     SELECT
       f.character_key,
       MAX(f.display_name) FILTER (WHERE f.display_name IS NOT NULL AND f.display_name <> '')
         AS display_name,
       MODE() WITHIN GROUP (ORDER BY f.effective_gender) AS gender_votes,
       COUNT(DISTINCT f.mod_id)::int AS mod_count,
       COALESCE(SUM(f.line_count), 0)::int AS line_count,
       link.voice_id AS linked_voice_id
     FROM folders f
     LEFT JOIN character_uk_voices link ON link.character_key = f.character_key
     WHERE f.character_key IS NOT NULL AND f.character_key <> ''
     GROUP BY f.character_key, link.voice_id
     ORDER BY f.character_key`,
    // Pass an int: substring(str FROM text) is regex in Postgres and drops voice:* keys.
    [voicePrefix + '%', voicePrefix.length + 1],
  );

  return rows.map((row) => {
    const voted = parseSpeakerGender(row.gender_votes);
    const folderHint = resolveGenderFromVoiceTypeName(row.character_key);
    const gender = toUkGender(voted !== 'unknown' ? voted : folderHint);
    return {
      characterKey: row.character_key,
      displayName: row.display_name,
      gender,
      age: inferCharacterAge(row.character_key, row.display_name),
      modCount: row.mod_count,
      lineCount: row.line_count,
      linkedVoiceId: row.linked_voice_id,
    };
  });
};
