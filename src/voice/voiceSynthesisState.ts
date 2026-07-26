import type { Tx } from '../db';
import { voiceTranslationMapKey } from './loadVoiceTranslations';

export type VoiceSynthesisStateRow = {
  modId: number;
  formidLower6: string;
  variant: number;
  targetLang: string;
  ttsTextVersion: string;
};

/** Load stored TTS text version for one voice line, or null when never synthesized. */
export const loadVoiceSynthesisVersion = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
  targetLang: string,
): Promise<string | null> => {
  const { rows } = await db.query<{ tts_text_version: string }>(
    `SELECT tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1
       AND formid_lower6 = $2
       AND variant = $3
       AND target_lang = $4`,
    [modId, formidLower6.toUpperCase(), variant, targetLang.trim().toLowerCase()],
  );
  return rows[0]?.tts_text_version ?? null;
};

/** All stored versions for one mod and target language, keyed by `FORMID6:variant`. */
export const loadVoiceSynthesisVersionMap = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    variant: number;
    tts_text_version: string;
  }>(
    `SELECT formid_lower6, variant, tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1 AND target_lang = $2`,
    [modId, targetLang.trim().toLowerCase()],
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    out.set(voiceTranslationMapKey(row.formid_lower6, row.variant), row.tts_text_version);
  }
  return out;
};

export const upsertVoiceSynthesisState = async (
  db: Tx,
  row: VoiceSynthesisStateRow,
): Promise<void> => {
  await db.query(
    `INSERT INTO voice_synthesis_state (
       mod_id, formid_lower6, variant, target_lang, tts_text_version, synthesized_at
     ) VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (mod_id, formid_lower6, variant, target_lang)
     DO UPDATE SET
       tts_text_version = EXCLUDED.tts_text_version,
       synthesized_at = NOW()`,
    [
      row.modId,
      row.formidLower6.toUpperCase(),
      row.variant,
      row.targetLang.trim().toLowerCase(),
      row.ttsTextVersion,
    ],
  );
};

/** Remove all synthesis version rows (does not delete `.fuz` files). */
export const clearAllVoiceSynthesisState = async (db: Tx): Promise<number> => {
  const { rowCount } = await db.query(`DELETE FROM voice_synthesis_state`);
  return rowCount ?? 0;
};
