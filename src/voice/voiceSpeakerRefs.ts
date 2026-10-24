import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { PATHS } from '../paths';
import { isVoiceFormidKey } from './voiceFormidKey';
import { normalizeVoiceOrigin } from './voiceOrigin';

export type VoiceSpeakerRefPick = {
  lineKey: string;
  variant: number;
  /** Normalized lower-case origin plugin; null/absent for legacy picks. */
  originPlugin?: string | null;
};

export type VoiceSpeakerRefMap = Record<string, VoiceSpeakerRefPick>;

const speakerRefsFilePath = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-refs.json');

const normalizeVoiceSpeakerRefPick = (pick: VoiceSpeakerRefPick): VoiceSpeakerRefPick => {
  const originPlugin = normalizeVoiceOrigin(pick.originPlugin);
  return {
    lineKey: pick.lineKey.toUpperCase(),
    variant: pick.variant,
    ...(originPlugin ? { originPlugin } : {}),
  };
};

const parseJsonSpeakerRefs = (raw: unknown): VoiceSpeakerRefMap => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const out: VoiceSpeakerRefMap = {};
  for (const [speakerKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!speakerKey.trim() || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const lineKey = (value as { lineKey?: unknown }).lineKey;
    const variant = (value as { variant?: unknown }).variant;
    if (typeof lineKey !== 'string' || !isVoiceFormidKey(lineKey)) continue;
    if (!Number.isInteger(variant) || (variant as number) < 1) continue;
    const originPlugin = (value as { originPlugin?: unknown }).originPlugin;
    out[speakerKey] = normalizeVoiceSpeakerRefPick({
      lineKey,
      variant: variant as number,
      originPlugin: typeof originPlugin === 'string' ? originPlugin : null,
    });
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
  const { rows } = await db.query<{
    speaker_key: string;
    line_key: string;
    variant: number;
    origin_plugin: string;
  }>(
    `SELECT speaker_key, line_key, variant, origin_plugin
     FROM voice_speaker_refs
     WHERE mod_id = $1
     ORDER BY speaker_key`,
    [modId],
  );

  const out: VoiceSpeakerRefMap = {};
  for (const row of rows) {
    out[row.speaker_key] = normalizeVoiceSpeakerRefPick({
      lineKey: row.line_key,
      variant: row.variant,
      originPlugin: row.origin_plugin,
    });
  }
  return out;
};

/** Load one speaker's saved TTS reference pick. */
export const loadVoiceSpeakerRef = async (
  db: Tx,
  modId: number,
  speakerKey: string,
): Promise<VoiceSpeakerRefPick | null> => {
  const key = speakerKey.trim();
  if (!key) return null;

  await migrateVoiceSpeakerRefsFromJsonIfNeeded(db, modId);
  const { rows } = await db.query<{ line_key: string; variant: number; origin_plugin: string }>(
    `SELECT line_key, variant, origin_plugin
     FROM voice_speaker_refs
     WHERE mod_id = $1 AND speaker_key = $2`,
    [modId, key],
  );
  const row = rows[0];
  if (!row) return null;
  return normalizeVoiceSpeakerRefPick({
    lineKey: row.line_key,
    variant: row.variant,
    originPlugin: row.origin_plugin,
  });
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
    `INSERT INTO voice_speaker_refs (mod_id, speaker_key, line_key, variant, auto_score, origin_plugin, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (mod_id, speaker_key) DO UPDATE SET
       line_key = EXCLUDED.line_key,
       variant = EXCLUDED.variant,
       auto_score = EXCLUDED.auto_score,
       origin_plugin = EXCLUDED.origin_plugin,
       updated_at = NOW()`,
    [
      modId,
      key,
      normalized.lineKey,
      normalized.variant,
      autoScore ?? null,
      normalized.originPlugin ?? '',
    ],
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
  lineKey: string,
  variant: number,
  origin?: string | null,
): boolean => {
  if (pick.lineKey.toUpperCase() !== lineKey.toUpperCase() || pick.variant !== variant)
    return false;
  const pickOrigin = normalizeVoiceOrigin(pick.originPlugin);
  const wantOrigin = normalizeVoiceOrigin(origin);
  return !pickOrigin || !wantOrigin || pickOrigin === wantOrigin;
};
