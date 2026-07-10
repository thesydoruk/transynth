import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { PATHS } from '../paths';

export type VoiceSpeakerRefPick = {
  formidLower6: string;
  variant: number;
};

export type VoiceSpeakerRefMap = Record<string, VoiceSpeakerRefPick>;

const speakerRefsFilePath = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-refs.json');

export const normalizeVoiceSpeakerRefPick = (pick: VoiceSpeakerRefPick): VoiceSpeakerRefPick => ({
  formidLower6: pick.formidLower6.toUpperCase(),
  variant: pick.variant,
});

const parseJsonSpeakerRefs = (raw: unknown): VoiceSpeakerRefMap => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: VoiceSpeakerRefMap = {};
  for (const [speakerKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!speakerKey.trim() || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const formidLower6 = (value as { formidLower6?: unknown }).formidLower6;
    const variant = (value as { variant?: unknown }).variant;
    if (typeof formidLower6 !== 'string' || !/^[0-9A-Fa-f]{6}$/.test(formidLower6)) continue;
    if (!Number.isInteger(variant) || (variant as number) < 1) continue;
    out[speakerKey] = normalizeVoiceSpeakerRefPick({ formidLower6, variant: variant as number });
  }
  return out;
};

/** One-time import of legacy `speaker-refs.json` into PostgreSQL. */
export const migrateVoiceSpeakerRefsFromJsonIfNeeded = async (
  db: Tx,
  modId: number,
): Promise<void> => {
  const filePath = speakerRefsFilePath(modId);
  if (!fs.existsSync(filePath)) return;

  let json: VoiceSpeakerRefMap;
  try {
    json = parseJsonSpeakerRefs(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
  } catch {
    fs.rmSync(filePath, { force: true });
    return;
  }

  for (const [speakerKey, pick] of Object.entries(json)) {
    await setVoiceSpeakerRef(db, modId, speakerKey, pick);
  }
  fs.rmSync(filePath, { force: true });
};

/** Load all per-speaker TTS reference picks for a mod. */
export const loadVoiceSpeakerRefs = async (db: Tx, modId: number): Promise<VoiceSpeakerRefMap> => {
  await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  const { rows } = await db.query<{ speaker_key: string; formid_lower6: string; variant: number }>(
    `SELECT speaker_key, formid_lower6, variant
     FROM voice_speaker_refs
     WHERE mod_id = $1
     ORDER BY speaker_key`,
    [modId],
  );

  const out: VoiceSpeakerRefMap = {};
  for (const row of rows) {
    out[row.speaker_key] = normalizeVoiceSpeakerRefPick({
      formidLower6: row.formid_lower6,
      variant: row.variant,
    });
  }
  return out;
};

export const loadVoiceSpeakerRefsMap = async (
  db: Tx,
  modId: number,
): Promise<Map<string, VoiceSpeakerRefPick>> =>
  new Map(Object.entries(await loadVoiceSpeakerRefs(db, modId)));

/** Load one speaker's saved TTS reference pick. */
export const loadVoiceSpeakerRef = async (
  db: Tx,
  modId: number,
  speakerKey: string,
): Promise<VoiceSpeakerRefPick | null> => {
  const key = speakerKey.trim();
  if (!key) return null;

  await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  const { rows } = await db.query<{ formid_lower6: string; variant: number }>(
    `SELECT formid_lower6, variant
     FROM voice_speaker_refs
     WHERE mod_id = $1 AND speaker_key = $2`,
    [modId, key],
  );
  const row = rows[0];
  if (!row) return null;
  return normalizeVoiceSpeakerRefPick({ formidLower6: row.formid_lower6, variant: row.variant });
};

/** Persist one speaker's TTS reference line pick. */
export const setVoiceSpeakerRef = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  pick: VoiceSpeakerRefPick,
  autoScore?: number | null,
): Promise<void> => {
  const key = speakerKey.trim();
  if (!key) throw new Error('Speaker key is required');

  const normalized = normalizeVoiceSpeakerRefPick(pick);
  await db.query(
    `INSERT INTO voice_speaker_refs (mod_id, speaker_key, formid_lower6, variant, auto_score, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (mod_id, speaker_key) DO UPDATE SET
       formid_lower6 = EXCLUDED.formid_lower6,
       variant = EXCLUDED.variant,
       auto_score = EXCLUDED.auto_score,
       updated_at = NOW()`,
    [modId, key, normalized.formidLower6, normalized.variant, autoScore ?? null],
  );
};

/** Remove a speaker's saved TTS reference pick (falls back to auto-selection). */
export const clearVoiceSpeakerRef = async (
  db: Tx,
  modId: number,
  speakerKey: string,
): Promise<void> => {
  const key = speakerKey.trim();
  if (!key) return;

  await db.query(`DELETE FROM voice_speaker_refs WHERE mod_id = $1 AND speaker_key = $2`, [
    modId,
    key,
  ]);
};

export const voiceSpeakerRefMatches = (
  pick: VoiceSpeakerRefPick,
  formidLower6: string,
  variant: number,
): boolean =>
  pick.formidLower6.toUpperCase() === formidLower6.toUpperCase() && pick.variant === variant;

/** @deprecated Legacy JSON path kept for migration only. */
export const legacyVoiceSpeakerRefsFilePath = speakerRefsFilePath;
