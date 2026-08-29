import type { Tx } from '../db';

export type VoiceSynthesisStateRow = {
  modId: number;
  formidLower6: string;
  variant: number;
  targetLang: string;
  /** Voice-type folder; empty only for rows migrated from the old primary key. */
  speakerKey: string;
  ttsTextVersion: string;
};

/** Trim a speaker folder name; missing values become `''` (legacy rows). */
export const normalizeVoiceSpeakerKey = (speakerKey: string | null | undefined): string =>
  speakerKey?.trim() ?? '';

/**
 * Map key for one physical take: speaker folder + FormID + response number.
 *
 * Nate and Nora share a FormID; without the folder they overwrite each other's
 * "already synthesized" stamp.
 */
export const voiceSynthesisStateKey = (
  speakerKey: string | null | undefined,
  formidLower6: string,
  variant: number,
): string => `${normalizeVoiceSpeakerKey(speakerKey)}:${formidLower6.toUpperCase()}:${variant}`;

/**
 * Stored TTS version for this take. Prefers the per-speaker stamp; if that
 * row was never written, falls back to a pre-speaker_key legacy row (`''`).
 *
 * Nate/Nora can share the legacy stamp — the `.fuz` on disk still decides
 * whether that speaker's take is present.
 */
export const lookupVoiceSynthesisVersion = (
  storedVersions: ReadonlyMap<string, string>,
  speakerKey: string | null | undefined,
  formidLower6: string,
  variant: number,
): string | null => {
  const exact = storedVersions.get(voiceSynthesisStateKey(speakerKey, formidLower6, variant));
  if (exact !== undefined) return exact;
  const speaker = normalizeVoiceSpeakerKey(speakerKey);
  if (!speaker) return null;
  return storedVersions.get(voiceSynthesisStateKey('', formidLower6, variant)) ?? null;
};

/** Speaker folder from `Sound/Voice/<plugin>/<Speaker>/<FormID>_<N>.fuz`. */
export const speakerKeyFromVoiceRelPath = (relPath: string): string => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '';
};

/** Load stored TTS text version for one speaker's take, or null when never synthesized. */
export const loadVoiceSynthesisVersion = async (
  db: Tx,
  modId: number,
  formidLower6: string,
  variant: number,
  targetLang: string,
  speakerKey: string,
): Promise<string | null> => {
  const { rows } = await db.query<{ tts_text_version: string }>(
    `SELECT tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1
       AND formid_lower6 = $2
       AND variant = $3
       AND target_lang = $4
       AND (speaker_key = $5 OR speaker_key = '')
     ORDER BY (speaker_key = $5) DESC
     LIMIT 1`,
    [
      modId,
      formidLower6.toUpperCase(),
      variant,
      targetLang.trim().toLowerCase(),
      normalizeVoiceSpeakerKey(speakerKey),
    ],
  );
  return rows[0]?.tts_text_version ?? null;
};

/** All stored versions for a mod/lang, keyed by {@link voiceSynthesisStateKey}. */
export const loadVoiceSynthesisVersionMap = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<Map<string, string>> => {
  const { rows } = await db.query<{
    formid_lower6: string;
    variant: number;
    speaker_key: string;
    tts_text_version: string;
  }>(
    `SELECT formid_lower6, variant, speaker_key, tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1 AND target_lang = $2`,
    [modId, targetLang.trim().toLowerCase()],
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    out.set(
      voiceSynthesisStateKey(row.speaker_key, row.formid_lower6, row.variant),
      row.tts_text_version,
    );
  }
  return out;
};

export const upsertVoiceSynthesisState = async (
  db: Tx,
  row: VoiceSynthesisStateRow,
): Promise<void> => {
  await db.query(
    `INSERT INTO voice_synthesis_state (
       mod_id, formid_lower6, variant, target_lang, speaker_key, tts_text_version, synthesized_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (mod_id, formid_lower6, variant, target_lang, speaker_key)
     DO UPDATE SET
       tts_text_version = EXCLUDED.tts_text_version,
       synthesized_at = NOW()`,
    [
      row.modId,
      row.formidLower6.toUpperCase(),
      row.variant,
      row.targetLang.trim().toLowerCase(),
      normalizeVoiceSpeakerKey(row.speakerKey),
      row.ttsTextVersion,
    ],
  );
};

/** Remove all synthesis version rows (does not delete `.fuz` files). */
export const clearAllVoiceSynthesisState = async (db: Tx): Promise<number> => {
  const { rowCount } = await db.query(`DELETE FROM voice_synthesis_state`);
  return rowCount ?? 0;
};

/** Remove synthesis stamps for one mod/language, optionally one speaker folder. */
export const clearModVoiceSynthesisState = async (
  db: Tx,
  modId: number,
  targetLang: string,
  speakerKey?: string,
): Promise<number> => {
  const lang = targetLang.trim().toLowerCase();
  const speaker = speakerKey?.trim();
  if (speaker) {
    const { rowCount } = await db.query(
      `DELETE FROM voice_synthesis_state
       WHERE mod_id = $1 AND target_lang = $2 AND speaker_key = $3`,
      [modId, lang, normalizeVoiceSpeakerKey(speaker)],
    );
    return rowCount ?? 0;
  }
  const { rowCount } = await db.query(
    `DELETE FROM voice_synthesis_state WHERE mod_id = $1 AND target_lang = $2`,
    [modId, lang],
  );
  return rowCount ?? 0;
};
