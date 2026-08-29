import type { Tx } from '../../../../db';
import {
  effectiveSpeakerGenderSql,
  parseSpeakerGender,
  type GenderSource,
  type SpeakerGender,
} from '../../../../dialog';
import { DIALOG_PROMPT_PATH, DIALOG_RESPONSE_PATH } from './lines';

/** One row of the speakers editor. */
export type DialogSpeakerRow = {
  speaker_key: string;
  display_name: string | null;
  voice_type: string | null;
  is_player: boolean;
  /** Gender resolved from plugin data during import. */
  detected_gender: SpeakerGender;
  detected_source: GenderSource | null;
  /** Gender set by a human, which wins over detection. */
  gender_override: SpeakerGender | null;
  /** Gender downstream consumers actually use. */
  effective_gender: SpeakerGender;
  /** Dialog nodes attributed to this speaker. */
  line_count: number;
};

type RawSpeakerRow = Omit<
  DialogSpeakerRow,
  'detected_gender' | 'gender_override' | 'effective_gender'
> & {
  detected_gender: string | null;
  gender_override: string | null;
  effective_gender: string | null;
};

const toSpeakerRow = (row: RawSpeakerRow): DialogSpeakerRow => ({
  ...row,
  detected_gender: parseSpeakerGender(row.detected_gender),
  gender_override: row.gender_override ? parseSpeakerGender(row.gender_override) : null,
  effective_gender: parseSpeakerGender(row.effective_gender),
});

/**
 * List the speakers of a mod, busiest first.
 *
 * Ordering by line count puts the speakers whose gender affects the most lines
 * at the top, which is the order a human wants to review them in.
 */
export const listDialogSpeakers = async (db: Tx, modId: number): Promise<DialogSpeakerRow[]> => {
  const { rows } = await db.query<RawSpeakerRow>(
    `SELECT sp.speaker_key, sp.display_name, sp.voice_type, sp.is_player,
            sp.detected_gender, sp.detected_source, sp.gender_override,
            ${effectiveSpeakerGenderSql('sp')} AS effective_gender,
            sp.line_count
     FROM dialog_speakers sp
     WHERE sp.mod_id = $1
     ORDER BY sp.line_count DESC, sp.display_name ASC NULLS LAST, sp.speaker_key ASC`,
    [modId],
  );
  return rows.map(toSpeakerRow);
};

/**
 * Set or clear the manual gender of one speaker.
 *
 * @param gender - New override, or null to fall back to the detected gender.
 * @returns The updated row, or null when the mod has no such speaker.
 */
export const setDialogSpeakerGenderOverride = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  gender: SpeakerGender | null,
): Promise<DialogSpeakerRow | null> => {
  const { rows } = await db.query<RawSpeakerRow>(
    `UPDATE dialog_speakers sp
        SET gender_override = $3, updated_at = NOW()
      WHERE sp.mod_id = $1 AND sp.speaker_key = $2
      RETURNING sp.speaker_key, sp.display_name, sp.voice_type, sp.is_player,
                sp.detected_gender, sp.detected_source, sp.gender_override,
                ${effectiveSpeakerGenderSql('sp')} AS effective_gender,
                sp.line_count`,
    [modId, speakerKey, gender],
  );
  const row = rows[0];
  return row ? toSpeakerRow(row) : null;
};

/**
 * Source strings of every line this speaker takes part in.
 *
 * Both roles count: changing a speaker's gender changes what the lines they
 * speak and the lines addressed to them must agree with, so QA has to be
 * recomputed for either side.
 */
export const listDialogSpeakerStringIds = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  srcLang: string,
): Promise<number[]> => {
  const { rows } = await db.query<{ id: number }>(
    `SELECT DISTINCT s.id
     FROM dialog_nodes dn
     JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = $1
     JOIN records r
       ON r.mod_id = dt.mod_id
      AND r.signature = 'INFO'
      AND r.formid_hex = dn.info_formid_hex
      AND r.path_simplified IN ($3, $4)
     JOIN strings s ON s.record_id = r.id AND s.lang = $5
     WHERE dn.speaker_key = $2 OR dn.addressee_speaker_key = $2`,
    [modId, speakerKey, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH, srcLang],
  );
  return rows.map((row) => row.id);
};
