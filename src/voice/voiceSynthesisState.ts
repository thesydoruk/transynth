import type { Tx } from '../db';
import { normalizeVoiceOrigin } from './voiceOrigin';

export type VoiceSynthesisStateRow = {
  modId: number;
  lineKey: string;
  variant: number;
  targetLang: string;
  /** Voice-type folder; empty only for rows migrated from the old primary key. */
  speakerKey: string;
  /**
   * Plugin that owns the line (lower-cased file name). Empty for rows written
   * before origins existed and for games without the notion.
   */
  originPlugin?: string | null;
  ttsTextVersion: string;
  /** ECAPA cosine vs the clone prompt; omitted when the TTS host did not send it. */
  voiceSimilarity?: number | null;
  /** The low-similarity run writing this take; omitted (cleared) by every other write. */
  resynthRunId?: number | null;
};

export type VoiceSimilarityMap = Map<string, number>;

/** Everything stored about one take, for the checks that need more than its version. */
export type VoiceSynthesisStamp = {
  ttsTextVersion: string;
  voiceSimilarity: number | null;
  resynthRunId: number | null;
};

export type VoiceSynthesisStampMap = Map<string, VoiceSynthesisStamp>;

/** Trim a speaker folder name; missing values become `''` (legacy rows). */
export const normalizeVoiceSpeakerKey = (speakerKey: string | null | undefined): string =>
  speakerKey?.trim() ?? '';

/**
 * Map key for one physical take: origin + speaker folder + FormID + response number.
 *
 * Nate and Nora share a FormID; without the folder they overwrite each other's
 * "already synthesized" stamp. Two masters of a patch can share a lower-6
 * FormID; without the origin so would they.
 */
export const voiceSynthesisStateKey = (
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): string => {
  const base = `${normalizeVoiceSpeakerKey(speakerKey)}:${lineKey.toUpperCase()}:${variant}`;
  const normalizedOrigin = normalizeVoiceOrigin(origin);
  return normalizedOrigin ? `${normalizedOrigin}/${base}` : base;
};

/**
 * The entry of a {@link voiceSynthesisStateKey} map for this take, trying the
 * most specific stamp first and then the rows older code wrote: without an
 * origin, and without a speaker folder.
 *
 * Nate/Nora can share the legacy stamp — the `.fuz` on disk still decides
 * whether that speaker's take is present.
 */
export const lookupVoiceSynthesisEntry = <T>(
  stored: ReadonlyMap<string, T>,
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): T | null => {
  const exact = stored.get(voiceSynthesisStateKey(speakerKey, lineKey, variant, origin));
  if (exact !== undefined) return exact;
  if (normalizeVoiceOrigin(origin)) {
    const noOrigin = stored.get(voiceSynthesisStateKey(speakerKey, lineKey, variant));
    if (noOrigin !== undefined) return noOrigin;
  }
  const speaker = normalizeVoiceSpeakerKey(speakerKey);
  if (!speaker) return null;
  return stored.get(voiceSynthesisStateKey('', lineKey, variant)) ?? null;
};

/** Stored TTS version for this take, or null when never synthesized. */
export const lookupVoiceSynthesisVersion = (
  storedVersions: ReadonlyMap<string, string>,
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): string | null => lookupVoiceSynthesisEntry(storedVersions, speakerKey, lineKey, variant, origin);

/** Speaker folder from `Sound/Voice/<plugin>/<Speaker>/<FormID>_<N>.fuz`. */
export const speakerKeyFromVoiceRelPath = (relPath: string): string => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '';
};

/** Load stored TTS text version for one speaker's take, or null when never synthesized. */
export const loadVoiceSynthesisVersion = async (
  db: Tx,
  modId: number,
  lineKey: string,
  variant: number,
  targetLang: string,
  speakerKey: string,
  origin?: string | null,
): Promise<string | null> => {
  const { rows } = await db.query<{ tts_text_version: string }>(
    `SELECT tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1
       AND line_key = $2
       AND variant = $3
       AND target_lang = $4
       AND (speaker_key = $5 OR speaker_key = '')
       AND (origin_plugin = $6 OR origin_plugin = '')
     ORDER BY (origin_plugin = $6) DESC, (speaker_key = $5) DESC
     LIMIT 1`,
    [
      modId,
      lineKey.toUpperCase(),
      variant,
      targetLang.trim().toLowerCase(),
      normalizeVoiceSpeakerKey(speakerKey),
      normalizeVoiceOrigin(origin),
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
    line_key: string;
    variant: number;
    speaker_key: string;
    origin_plugin: string;
    tts_text_version: string;
  }>(
    `SELECT line_key, variant, speaker_key, origin_plugin, tts_text_version
     FROM voice_synthesis_state
     WHERE mod_id = $1 AND target_lang = $2`,
    [modId, targetLang.trim().toLowerCase()],
  );
  const out = new Map<string, string>();
  for (const row of rows) {
    out.set(
      voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin),
      row.tts_text_version,
    );
  }
  return out;
};

export const loadVoiceSimilarityMap = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<VoiceSimilarityMap> => {
  const { rows } = await db.query<{
    line_key: string;
    variant: number;
    speaker_key: string;
    origin_plugin: string;
    voice_similarity: number;
  }>(
    `SELECT line_key, variant, speaker_key, origin_plugin, voice_similarity
     FROM voice_synthesis_state
     WHERE mod_id = $1 AND target_lang = $2 AND voice_similarity IS NOT NULL`,
    [modId, targetLang.trim().toLowerCase()],
  );
  const out: VoiceSimilarityMap = new Map();
  for (const row of rows) {
    out.set(
      voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin),
      Number(row.voice_similarity),
    );
  }
  return out;
};

export const lookupVoiceSimilarity = (
  stored: ReadonlyMap<string, number>,
  speakerKey: string | null | undefined,
  lineKey: string,
  variant: number,
  origin?: string | null,
): number | null => lookupVoiceSynthesisEntry(stored, speakerKey, lineKey, variant, origin);

/** All stamps for a mod/lang, keyed by {@link voiceSynthesisStateKey}. */
export const loadVoiceSynthesisStampMap = async (
  db: Tx,
  modId: number,
  targetLang: string,
): Promise<VoiceSynthesisStampMap> => {
  const { rows } = await db.query<{
    line_key: string;
    variant: number;
    speaker_key: string;
    origin_plugin: string;
    tts_text_version: string;
    voice_similarity: number | string | null;
    resynth_run_id: number | null;
  }>(
    `SELECT line_key, variant, speaker_key, origin_plugin, tts_text_version, voice_similarity,
            resynth_run_id
     FROM voice_synthesis_state
     WHERE mod_id = $1 AND target_lang = $2`,
    [modId, targetLang.trim().toLowerCase()],
  );
  const out: VoiceSynthesisStampMap = new Map();
  for (const row of rows) {
    out.set(voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin), {
      ttsTextVersion: row.tts_text_version,
      voiceSimilarity: row.voice_similarity == null ? null : Number(row.voice_similarity),
      resynthRunId: row.resynth_run_id,
    });
  }
  return out;
};

export const upsertVoiceSynthesisState = async (
  db: Tx,
  row: VoiceSynthesisStateRow,
): Promise<void> => {
  await db.query(
    `INSERT INTO voice_synthesis_state (
       mod_id, line_key, variant, target_lang, speaker_key, origin_plugin, tts_text_version,
       voice_similarity, resynth_run_id, synthesized_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (mod_id, origin_plugin, line_key, variant, target_lang, speaker_key)
     DO UPDATE SET
       tts_text_version = EXCLUDED.tts_text_version,
       synthesized_at = NOW(),
       voice_similarity = COALESCE(EXCLUDED.voice_similarity, voice_synthesis_state.voice_similarity),
       resynth_run_id = EXCLUDED.resynth_run_id`,
    [
      row.modId,
      row.lineKey.toUpperCase(),
      row.variant,
      row.targetLang.trim().toLowerCase(),
      normalizeVoiceSpeakerKey(row.speakerKey),
      normalizeVoiceOrigin(row.originPlugin),
      row.ttsTextVersion,
      row.voiceSimilarity ?? null,
      row.resynthRunId ?? null,
    ],
  );
  // The take now has its own stamp; a row this speaker's take had before origins existed
  // would linger beside it and be counted twice (low-similarity count, revisions). The
  // shared no-speaker row stays: Nate and Nora may both still fall back to it. Which
  // origin a legacy row belonged to is not recorded: if two origins of one mod share
  // speaker, lower-6 and response, the other take loses its fallback and is synthesized
  // once more — a redundant take, never a wrong one.
  if (normalizeVoiceOrigin(row.originPlugin) && normalizeVoiceSpeakerKey(row.speakerKey)) {
    await db.query(
      `DELETE FROM voice_synthesis_state
       WHERE mod_id = $1 AND line_key = $2 AND variant = $3 AND target_lang = $4
         AND speaker_key = $5 AND origin_plugin = ''`,
      [
        row.modId,
        row.lineKey.toUpperCase(),
        row.variant,
        row.targetLang.trim().toLowerCase(),
        normalizeVoiceSpeakerKey(row.speakerKey),
      ],
    );
  }
};

/**
 * Record that a low-similarity run looked at this take and kept the old file.
 * Marks the legacy rows too (no speaker folder, no origin), since the lookup
 * falls back to them.
 */
export const markVoiceResynthHandled = async (
  db: Tx,
  take: Pick<
    VoiceSynthesisStateRow,
    'modId' | 'lineKey' | 'variant' | 'targetLang' | 'speakerKey' | 'originPlugin'
  >,
  runId: number,
): Promise<void> => {
  await db.query(
    `UPDATE voice_synthesis_state
     SET resynth_run_id = $6
     WHERE mod_id = $1 AND line_key = $2 AND variant = $3 AND target_lang = $4
       AND speaker_key IN ($5, '')
       AND origin_plugin IN ($7, '')`,
    [
      take.modId,
      take.lineKey.toUpperCase(),
      take.variant,
      take.targetLang.trim().toLowerCase(),
      normalizeVoiceSpeakerKey(take.speakerKey),
      runId,
      normalizeVoiceOrigin(take.originPlugin),
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
