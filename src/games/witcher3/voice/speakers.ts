/**
 * Put the scenes' speakers on a Witcher 3 mod's voice clips.
 *
 * Every clip's `speaker_key` becomes the voice tag that says it (`GERALT`,
 * `TOUSSAINT ARMOURER 01`), its addressee goes into `game_data.addressee`, and
 * each tag becomes a `dialog_speakers` row with the gender the game's
 * voice-tag table gives it. Geralt is the player and written male.
 */
import type { Tx } from '../../../db';
import type { SpeakerGender } from '../../../dialog/gender';
import type { W3SceneSpeakers } from '../scenes';

/** The protagonist's voice tag. Ciri is played too, but only for stretches; she is not "the player". */
const W3_PLAYER_VOICE_TAG = 'GERALT';

/** `TOUSSAINT ARMOURER 01` → `Toussaint Armourer 01`. */
export const w3SpeakerDisplayName = (tag: string): string =>
  tag
    .toLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase());

export type W3SpeakerPersistResult = { clips: number; speakers: number; withGender: number };

export const persistW3Speakers = async (
  db: Tx,
  modId: number,
  speakers: W3SceneSpeakers,
): Promise<W3SpeakerPersistResult> => {
  const { rows } = await db.query<{ line_key: string }>(
    `SELECT line_key FROM voice_clips WHERE mod_id = $1`,
    [modId],
  );
  const keys: string[] = [];
  const tags: string[] = [];
  const addressees: Array<string | null> = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const line = speakers.lines.get(Number(row.line_key));
    if (!line) continue;
    keys.push(row.line_key);
    tags.push(line.speaker);
    addressees.push(line.addressee);
    counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
  }

  await db.query(
    `UPDATE voice_clips vc
        SET speaker_key = u.tag,
            game_data = CASE WHEN u.addressee IS NULL THEN vc.game_data - 'addressee'
                             ELSE vc.game_data || jsonb_build_object('addressee', u.addressee) END
       FROM UNNEST($2::text[], $3::text[], $4::text[]) AS u(line_key, tag, addressee)
      WHERE vc.mod_id = $1 AND vc.line_key = u.line_key`,
    [modId, keys, tags, addressees],
  );

  // Addressees are speakers too: their gender is what a line spoken *to* them needs.
  const everyone = new Set([...counts.keys(), ...addressees.filter((a): a is string => !!a)]);
  const list = [...everyone].sort();
  const gender = (tag: string): SpeakerGender => speakers.genders.get(tag) ?? 'unknown';
  await db.query(`DELETE FROM dialog_speakers WHERE mod_id = $1`, [modId]);
  await db.query(
    `INSERT INTO dialog_speakers(
       mod_id, speaker_key, display_name, voice_type, is_player,
       detected_gender, detected_source, line_count
     )
     SELECT $1, * FROM UNNEST(
       $2::text[], $3::text[], $4::text[], $5::boolean[], $6::text[], $7::text[], $8::int[]
     )`,
    [
      modId,
      list,
      list.map(w3SpeakerDisplayName),
      list.map(() => null),
      list.map((tag) => tag === W3_PLAYER_VOICE_TAG),
      list.map(gender),
      list.map((tag) => (gender(tag) === 'unknown' ? null : 'plugin')),
      list.map((tag) => counts.get(tag) ?? 0),
    ],
  );
  return {
    clips: keys.length,
    speakers: list.length,
    withGender: list.filter((tag) => gender(tag) !== 'unknown').length,
  };
};
