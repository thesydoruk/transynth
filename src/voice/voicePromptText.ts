/**
 * Fallback text for voiced player lines that carry no `INFO\NAM1`.
 *
 * Fallout 4 player dialogue usually stores the wheel prompt in `RNAM` and the
 * spoken line in `NAM1`. For short confirmations Bethesda skips `NAM1` entirely
 * and the player speaks the prompt — e.g. `PlayerVoiceFemale01/00112036_1.fuz`
 * ("Trade") or `001A6AC3_1.fuz` ("That's all for now"). Those INFOs are voiced and
 * translated, so the audio must resolve to the `RNAM` string instead.
 *
 * Only INFOs **without any** `NAM1` row are considered, so a real response line
 * never loses to its wheel label. Prompt-only INFOs have no `TRDA`, hence the
 * single response number 1.
 */
import type { Tx } from '../db';
import {
  INFO_NAM1_RECORD_PATHS,
  INFO_PROMPT_RECORD_PATHS,
  infoNam1RecordsSql,
  infoPromptRecordsSql,
  normalizeVoiceText,
  voiceTranslationMapKey,
  type VoiceSourceDetailRow,
  type VoiceTranslationRow,
} from './voiceTextRows';

/** Voice files for a prompt-only INFO always use response number 1. */
const PROMPT_VOICE_VARIANT = 1;

/** INFO rows holding a prompt while the same record has no NAM1 line anywhere. */
const promptOnlyInfoSql = (promptPathParam: string, nam1PathParam: string): string =>
  `${infoPromptRecordsSql('r', promptPathParam)}
   AND NOT EXISTS (
     SELECT 1 FROM records n
     WHERE n.mod_id = r.mod_id
       AND n.formid_hex = r.formid_hex
       AND ${infoNam1RecordsSql('n', nam1PathParam)}
   )`;

/** Load `INFO\RNAM` source lines for prompt-only INFOs, keyed like NAM1 rows. */
export const loadVoicePromptSources = async (
  db: Tx,
  modId: number,
  srcLang: string,
): Promise<Map<string, VoiceSourceDetailRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    string_id: number;
    source: string;
  }>(
    `SELECT UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
            r.formid_hex AS info_formid_hex,
            s.id AS string_id,
            s.text_raw AS source
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     WHERE r.mod_id = $1
       AND ${promptOnlyInfoSql('$3', '$4')}
     ORDER BY r.formid_hex, s.id`,
    [modId, srcLang, [...INFO_PROMPT_RECORD_PATHS], [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceSourceDetailRow>();
  for (const row of rows) {
    const source = normalizeVoiceText(row.source);
    if (!source) continue;
    const key = voiceTranslationMapKey(row.formid_lower6, PROMPT_VOICE_VARIANT);
    if (map.has(key)) continue;
    map.set(key, { source, infoFormidHex: row.info_formid_hex, stringId: row.string_id });
  }
  return map;
};

/** Load translated `INFO\RNAM` prompts for prompt-only INFOs, keyed like NAM1 rows. */
export const loadVoicePromptTranslations = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
): Promise<Map<string, VoiceTranslationRow>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    info_formid_hex: string;
    string_id: number;
    edid: string | null;
    source: string;
    translation_id: number | null;
    status: string | null;
    translation: string;
  }>(
    `SELECT UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
            r.formid_hex AS info_formid_hex,
            s.id AS string_id,
            r.edid,
            s.text_raw AS source,
            t.id AS translation_id,
            t.status,
            t.text AS translation
     FROM records r
     JOIN strings s ON s.record_id = r.id AND s.lang = $2
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $3
     WHERE r.mod_id = $1
       AND t.text IS NOT NULL AND BTRIM(t.text) <> ''
       AND ${promptOnlyInfoSql('$4', '$5')}
     ORDER BY r.formid_hex, s.id`,
    [modId, srcLang, tgtLang, [...INFO_PROMPT_RECORD_PATHS], [...INFO_NAM1_RECORD_PATHS]],
  );

  const map = new Map<string, VoiceTranslationRow>();
  for (const row of rows) {
    const key = voiceTranslationMapKey(row.formid_lower6, PROMPT_VOICE_VARIANT);
    if (map.has(key)) continue;
    map.set(key, {
      formidLower6: row.formid_lower6,
      infoFormidHex: row.info_formid_hex,
      voiceVariant: PROMPT_VOICE_VARIANT,
      stringId: row.string_id,
      translationId: row.translation_id,
      status: row.status,
      translation: row.translation,
      source: row.source,
      edid: row.edid,
    });
  }
  return map;
};
