/**
 * Stored vocal effort of a mod's original takes (`voice_clip_effort`).
 *
 * Features are measured once per take — decoding 116,000 takes of a base game
 * is the slow part. Strength and tag are derived, and are rewritten whenever
 * the mod is analyzed again. Keys are {@link voiceSynthesisStateKey}s, the
 * same as the synthesis stamps of the takes.
 */
import type { Tx } from '../db';
import type { EffortFeatures, EffortTag } from './vocalEffort';
import { normalizeVoiceOrigin } from './voiceOrigin';
import { normalizeVoiceSpeakerKey, voiceSynthesisStateKey } from './voiceSynthesisState';

export type ClipEffortRow = {
  speakerKey: string;
  lineKey: string;
  variant: number;
  originPlugin?: string | null;
  /** Null when the take held too little speech to measure. */
  features: EffortFeatures | null;
  strength: number | null;
  tag: EffortTag | null;
};

/** Rows per statement; keeps the parameter arrays small for a base game. */
const SAVE_CHUNK = 5000;

const TAGS: readonly EffortTag[] = ['loud', 'shouting'];
const asTag = (value: string | null): EffortTag | null =>
  TAGS.includes(value as EffortTag) ? (value as EffortTag) : null;

/** Features of every take analyzed so far; null for a take that could not be measured. */
export const loadClipEffortFeatures = async (
  db: Tx,
  modId: number,
): Promise<Map<string, EffortFeatures | null>> => {
  const { rows } = await db.query<{
    origin_plugin: string;
    speaker_key: string;
    line_key: string;
    variant: number;
    f0_median_st: number | null;
    brightness_db: number | null;
    voiced_ratio: number | null;
  }>(
    `SELECT origin_plugin, speaker_key, line_key, variant,
            f0_median_st, brightness_db, voiced_ratio
       FROM voice_clip_effort
      WHERE mod_id = $1`,
    [modId],
  );
  const features = new Map<string, EffortFeatures | null>();
  for (const row of rows) {
    const measured = row.f0_median_st != null && row.brightness_db != null;
    features.set(
      voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin),
      measured
        ? {
            f0MedianSt: Number(row.f0_median_st),
            brightnessDb: Number(row.brightness_db),
            voicedRatio: Number(row.voiced_ratio ?? 0),
          }
        : null,
    );
  }
  return features;
};

/** Insert or replace the rows of the given takes. */
export const saveClipEffort = async (
  db: Tx,
  modId: number,
  rows: readonly ClipEffortRow[],
): Promise<void> => {
  for (let start = 0; start < rows.length; start += SAVE_CHUNK) {
    const chunk = rows.slice(start, start + SAVE_CHUNK);
    await db.query(
      `INSERT INTO voice_clip_effort (
         mod_id, origin_plugin, speaker_key, line_key, variant,
         f0_median_st, brightness_db, voiced_ratio, strength, tag, analyzed_at
       )
       SELECT $1, t.origin_plugin, t.speaker_key, t.line_key, t.variant,
              t.f0_median_st, t.brightness_db, t.voiced_ratio, t.strength, t.tag, NOW()
         FROM UNNEST(
           $2::text[], $3::text[], $4::text[], $5::int[],
           $6::float8[], $7::float8[], $8::float8[], $9::float8[], $10::text[]
         ) AS t(origin_plugin, speaker_key, line_key, variant,
                f0_median_st, brightness_db, voiced_ratio, strength, tag)
       ON CONFLICT (mod_id, origin_plugin, speaker_key, line_key, variant)
       DO UPDATE SET
         f0_median_st = EXCLUDED.f0_median_st,
         brightness_db = EXCLUDED.brightness_db,
         voiced_ratio = EXCLUDED.voiced_ratio,
         strength = EXCLUDED.strength,
         tag = EXCLUDED.tag,
         analyzed_at = NOW()`,
      [
        modId,
        chunk.map((row) => normalizeVoiceOrigin(row.originPlugin)),
        chunk.map((row) => normalizeVoiceSpeakerKey(row.speakerKey)),
        chunk.map((row) => row.lineKey.toUpperCase()),
        chunk.map((row) => row.variant),
        chunk.map((row) => row.features?.f0MedianSt ?? null),
        chunk.map((row) => row.features?.brightnessDb ?? null),
        chunk.map((row) => row.features?.voicedRatio ?? null),
        chunk.map((row) => row.strength),
        chunk.map((row) => row.tag),
      ],
    );
  }
};

/** The tag of every take that has one. */
export const loadVoiceEffortTags = async (
  db: Tx,
  modId: number,
): Promise<Map<string, EffortTag>> => {
  const { rows } = await db.query<{
    origin_plugin: string;
    speaker_key: string;
    line_key: string;
    variant: number;
    tag: string | null;
  }>(
    `SELECT origin_plugin, speaker_key, line_key, variant, tag
       FROM voice_clip_effort
      WHERE mod_id = $1 AND tag IS NOT NULL`,
    [modId],
  );
  const tags = new Map<string, EffortTag>();
  for (const row of rows) {
    const tag = asTag(row.tag);
    if (!tag) continue;
    tags.set(
      voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin),
      tag,
    );
  }
  return tags;
};
