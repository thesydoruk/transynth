/**
 * Write measured features of original takes while an analysis is still running.
 *
 * Only the measurement is written: a take that already has a row keeps its
 * strength and tag (a forced re-measure must not drop the tags in force if it
 * is killed half way), and a new take gets NULL for both, which reads as "no
 * tag" until the analysis plans the whole mod at its end.
 */
import type { Tx } from '../db';
import type { EffortFeatures } from './vocalEffort';
import { normalizeVoiceOrigin } from './voiceOrigin';
import { normalizeVoiceSpeakerKey } from './voiceSynthesisState';

export type ClipEffortFeaturesRow = {
  speakerKey: string;
  lineKey: string;
  variant: number;
  originPlugin?: string | null;
  /** Null when the take held too little speech to measure. */
  features: EffortFeatures | null;
};

export const saveClipEffortFeatures = async (
  db: Tx,
  modId: number,
  rows: readonly ClipEffortFeaturesRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  await db.query(
    `INSERT INTO voice_clip_effort (
       mod_id, origin_plugin, speaker_key, line_key, variant,
       f0_median_st, brightness_db, voiced_ratio, analyzed_at
     )
     SELECT $1, t.origin_plugin, t.speaker_key, t.line_key, t.variant,
            t.f0_median_st, t.brightness_db, t.voiced_ratio, NOW()
       FROM UNNEST(
         $2::text[], $3::text[], $4::text[], $5::int[],
         $6::float8[], $7::float8[], $8::float8[]
       ) AS t(origin_plugin, speaker_key, line_key, variant,
              f0_median_st, brightness_db, voiced_ratio)
     ON CONFLICT (mod_id, origin_plugin, speaker_key, line_key, variant)
     DO UPDATE SET
       f0_median_st = EXCLUDED.f0_median_st,
       brightness_db = EXCLUDED.brightness_db,
       voiced_ratio = EXCLUDED.voiced_ratio,
       analyzed_at = NOW()`,
    [
      modId,
      rows.map((row) => normalizeVoiceOrigin(row.originPlugin)),
      rows.map((row) => normalizeVoiceSpeakerKey(row.speakerKey)),
      rows.map((row) => row.lineKey.toUpperCase()),
      rows.map((row) => row.variant),
      rows.map((row) => row.features?.f0MedianSt ?? null),
      rows.map((row) => row.features?.brightnessDb ?? null),
      rows.map((row) => row.features?.voicedRatio ?? null),
    ],
  );
};
