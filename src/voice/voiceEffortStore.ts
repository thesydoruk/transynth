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

/**
 * Features of every take analyzed so far; null for a take that could not be measured.
 * A row a person created by choosing a tag for a take never analyzed is left out, so
 * the next analysis still measures that take.
 */
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
      WHERE mod_id = $1 AND analyzed_at IS NOT NULL`,
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

/** What `tag_override` may hold: no tag at all, or one of the tags. NULL in the column is "auto". */
export type EffortTagOverride = EffortTag | 'none';

/**
 * SQL for the tag in force for a row of `voice_clip_effort` (alias-free; prefix
 * the columns yourself in a join): the person's choice when there is one, the
 * derived tag otherwise. NULL when the take has no tag.
 */
export const EFFECTIVE_EFFORT_TAG_SQL = `CASE
  WHEN tag_override IS NULL THEN tag
  WHEN tag_override = 'none' THEN NULL
  ELSE tag_override
END`;

/** The tag in force for every take that has one — an override wins over the derived tag. */
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
    `SELECT origin_plugin, speaker_key, line_key, variant, ${EFFECTIVE_EFFORT_TAG_SQL} AS tag
       FROM voice_clip_effort
      WHERE mod_id = $1 AND (tag IS NOT NULL OR tag_override IS NOT NULL)`,
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

const OVERRIDES: readonly EffortTagOverride[] = ['none', 'loud', 'shouting'];
const asOverride = (value: string | null): EffortTagOverride | null =>
  OVERRIDES.includes(value as EffortTagOverride) ? (value as EffortTagOverride) : null;

/** The tag in force for one take, the same rule as {@link EFFECTIVE_EFFORT_TAG_SQL}. */
export const effectiveEffortTag = (
  tag: EffortTag | null,
  override: EffortTagOverride | null,
): EffortTag | null => {
  if (override == null) return tag;
  return override === 'none' ? null : override;
};

/** One original take, keyed the way the analysis stored it. */
export type ClipEffortTake = {
  speakerKey: string;
  lineKey: string;
  variant: number;
  originPlugin?: string | null;
};

/** What the editor shows for one take: the measured strength, the derived tag and a person's choice. */
export type ClipEffortState = {
  strength: number | null;
  tag: EffortTag | null;
  override: EffortTagOverride | null;
};

type ClipEffortStateRow = {
  strength: number | null;
  tag: string | null;
  tag_override: string | null;
};

const stateOf = (row: ClipEffortStateRow | undefined): ClipEffortState => ({
  strength: row?.strength == null ? null : Number(row.strength),
  tag: asTag(row?.tag ?? null),
  override: asOverride(row?.tag_override ?? null),
});

const takeParams = (modId: number, take: ClipEffortTake) => [
  modId,
  normalizeVoiceOrigin(take.originPlugin),
  normalizeVoiceSpeakerKey(take.speakerKey),
  take.lineKey.toUpperCase(),
  take.variant,
];

const TAKE_WHERE = `mod_id = $1 AND origin_plugin = $2 AND speaker_key = $3
  AND line_key = $4 AND variant = $5`;

/** Effort of every take of one speaker, by {@link voiceSynthesisStateKey}. */
export const loadSpeakerClipEffort = async (
  db: Tx,
  modId: number,
  speakerKey: string,
): Promise<Map<string, ClipEffortState>> => {
  const { rows } = await db.query<
    ClipEffortStateRow & {
      origin_plugin: string;
      speaker_key: string;
      line_key: string;
      variant: number;
    }
  >(
    `SELECT origin_plugin, speaker_key, line_key, variant, strength, tag, tag_override
       FROM voice_clip_effort
      WHERE mod_id = $1 AND speaker_key = $2`,
    [modId, normalizeVoiceSpeakerKey(speakerKey)],
  );
  const states = new Map<string, ClipEffortState>();
  for (const row of rows) {
    states.set(
      voiceSynthesisStateKey(row.speaker_key, row.line_key, row.variant, row.origin_plugin),
      stateOf(row),
    );
  }
  return states;
};

/** Effort of one take; all nulls when it was neither analyzed nor tagged by hand. */
export const loadClipEffort = async (
  db: Tx,
  modId: number,
  take: ClipEffortTake,
): Promise<ClipEffortState> => {
  const { rows } = await db.query<ClipEffortStateRow>(
    `SELECT strength, tag, tag_override FROM voice_clip_effort WHERE ${TAKE_WHERE}`,
    takeParams(modId, take),
  );
  return stateOf(rows[0]);
};

/**
 * Record a person's choice for one take; null goes back to the derived tag.
 *
 * A take of a mod never analyzed has no row yet: it gets one with nothing
 * measured and no `analyzed_at`, which analysis treats as not measured. Only
 * `tag_override` is written — features, strength and tag stay the analysis's.
 */
export const saveEffortTagOverride = async (
  db: Tx,
  modId: number,
  take: ClipEffortTake,
  override: EffortTagOverride | null,
): Promise<ClipEffortState> => {
  const params = takeParams(modId, take);
  if (override == null) {
    // A row that held nothing but the choice has nothing left to keep.
    await db.query(
      `DELETE FROM voice_clip_effort WHERE ${TAKE_WHERE} AND analyzed_at IS NULL`,
      params,
    );
    const { rows } = await db.query<ClipEffortStateRow>(
      `UPDATE voice_clip_effort SET tag_override = NULL WHERE ${TAKE_WHERE}
       RETURNING strength, tag, tag_override`,
      params,
    );
    return stateOf(rows[0]);
  }
  const { rows } = await db.query<ClipEffortStateRow>(
    `INSERT INTO voice_clip_effort (
       mod_id, origin_plugin, speaker_key, line_key, variant, tag_override, analyzed_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NULL)
     ON CONFLICT (mod_id, origin_plugin, speaker_key, line_key, variant)
     DO UPDATE SET tag_override = EXCLUDED.tag_override
     RETURNING strength, tag, tag_override`,
    [...params, override],
  );
  return stateOf(rows[0]);
};

/**
 * Per analyzed speaker, whether it has a calm baseline — a speaker without one
 * gets no tags (fewer calm lines than the planner needs). A speaker missing from
 * the map was never analyzed.
 */
export const loadSpeakerEffortBaselines = async (
  db: Tx,
  modId: number,
): Promise<Map<string, boolean>> => {
  const { rows } = await db.query<{ speaker_key: string; has_baseline: boolean }>(
    `SELECT speaker_key, BOOL_OR(strength IS NOT NULL) AS has_baseline
       FROM voice_clip_effort
      WHERE mod_id = $1 AND analyzed_at IS NOT NULL
      GROUP BY speaker_key`,
    [modId],
  );
  return new Map(rows.map((row) => [row.speaker_key, row.has_baseline === true]));
};
