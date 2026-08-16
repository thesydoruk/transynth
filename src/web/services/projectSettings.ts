/**
 * projectSettings.ts — Project-wide workflow and QA configuration.
 *
 * Settings are stored in the `project_settings` table as key/JSONB pairs
 * and are shared across all users of the project.  They control runtime
 * behaviour for translation saving, QA checks, and editor display defaults.
 *
 * Each setting has a typed default defined in SETTING_DEFAULTS.  DB rows only
 * need to exist for values that differ from the default; the helpers here
 * merge DB values on top automatically.
 */

import type { Tx } from '../../db';
import { clampRagMaxExamples } from '../../llm/ragConstants';
import { normalizeVllmServerEntries, type VllmServerEntry } from '../../llm/vllmServerConfig';
import {
  clampDependencyWaitTimeoutSec,
  clampHealthCheckIntervalSec,
  DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC,
  DEFAULT_HEALTH_CHECK_INTERVAL_SEC,
} from '../../pipeline/settings';
import { normalizeGameTtsSettings, type GameTtsSettingsMap } from '../../voice/gameTtsSettings';

/* ── Setting keys and value types ───────────────────────────────────────── */

/**
 * Union of all valid project setting keys.
 *
 * Naming convention: `<domain>.<name>`, e.g. `workflow.auto_approve_on_save`.
 */
export type ProjectSettingKey =
  /** When true, manually saved translations jump directly to `reviewed` status instead of `draft`. */
  | 'workflow.auto_approve_on_save'
  /** When true, saved translations are propagated to other untranslated strings with identical source text. */
  | 'workflow.propagate_to_identical'
  /** When true, strings flagged as ignored are hidden in the editor by default. */
  | 'workflow.hide_ignored_by_default'
  /** When true, QA checks whether source and translation end with the same punctuation type. */
  | 'qa.end_punct_match'
  /** Minimum word count required in a translation (0 = disabled). */
  | 'qa.min_word_count'
  /** When true, TES4 header records are excluded during ESP/ESM file import. */
  | 'import.skip_tes4'
  /** Max reference examples per string sent to the LLM (1–{@link RAG_MAX_EXAMPLES}). RAG is always required. */
  | 'llm.rag_max_examples'
  /** Minimum cosine similarity for embedding-based RAG retrieval (0–1). */
  | 'llm.rag_min_similarity'
  /** When true, each voiced line uses its own English audio as the TTS reference clip. */
  | 'voice.line_reference'
  /** Per-game xtts-engine match_loudness / match_timing (`{ fo4: { matchLoudness, matchTiming }, … }`). */
  | 'voice.game_tts'
  /** Fish Speech sampling temperature. */
  | 'voice.temperature'
  /** Fish Speech repetition penalty. */
  | 'voice.repetition_penalty'
  /** Fish Speech nucleus sampling top-p (0–1). */
  | 'voice.top_p'
  /** Max concurrent Fish Speech TTS HTTP requests (1–32). */
  | 'voice.tts_max_parallel_fish_speech'
  /**
   * vLLM chat pool (`[{host, maxParallel, apiKey}, …]`).
   * Empty = fall back to env `VLLM_SERVERS` / `VLLM_BASE_URL`.
   */
  | 'llm.vllm_servers'
  /** How long jobs wait for LLM/TTS health before failing (seconds). */
  | 'pipeline.dependency_wait_timeout_sec'
  /** Pause between failed LLM/TTS health probes (seconds). */
  | 'pipeline.health_check_interval_sec';

/** Typed shape of all project settings. */
export type ProjectSettings = {
  'workflow.auto_approve_on_save': boolean;
  'workflow.propagate_to_identical': boolean;
  'workflow.hide_ignored_by_default': boolean;
  'qa.end_punct_match': boolean;
  'qa.min_word_count': number;
  'import.skip_tes4': boolean;
  'llm.rag_max_examples': number;
  'llm.rag_min_similarity': number;
  'voice.line_reference': boolean;
  'voice.game_tts': GameTtsSettingsMap;
  'voice.temperature': number;
  'voice.repetition_penalty': number;
  'voice.top_p': number;
  'voice.tts_max_parallel_fish_speech': number;
  'llm.vllm_servers': VllmServerEntry[];
  'pipeline.dependency_wait_timeout_sec': number;
  'pipeline.health_check_interval_sec': number;
};

/** Clamp TTS parallel request limits to 1–32. */
export const clampTtsMaxParallel = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(32, Math.max(1, Math.round(value)));
};

/**
 * Built-in defaults for every project setting.
 *
 * These are used both as the canonical type reference and as fallback values
 * when a key has not been persisted to the database yet.
 */
export const SETTING_DEFAULTS: ProjectSettings = {
  'workflow.auto_approve_on_save': false,
  'workflow.propagate_to_identical': true,
  'workflow.hide_ignored_by_default': false,
  'qa.end_punct_match': true,
  'qa.min_word_count': 1,
  'import.skip_tes4': false,
  'llm.rag_max_examples': 5,
  'llm.rag_min_similarity': 0.5,
  'voice.line_reference': true,
  'voice.game_tts': {},
  'voice.temperature': 0.65,
  'voice.repetition_penalty': 1.2,
  'voice.top_p': 0.8,
  'voice.tts_max_parallel_fish_speech': 1,
  'llm.vllm_servers': [],
  'pipeline.dependency_wait_timeout_sec': DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC,
  'pipeline.health_check_interval_sec': DEFAULT_HEALTH_CHECK_INTERVAL_SEC,
};

/* ── DB helpers ─────────────────────────────────────────────────────────── */

/**
 * Fetches all project settings, merging persisted DB values on top of the
 * built-in defaults.  Missing keys fall back to SETTING_DEFAULTS silently.
 *
 * @param db - Database connection or pool.
 * @returns Full ProjectSettings object with all keys populated.
 */
export const getAllProjectSettings = async (db: Tx): Promise<ProjectSettings> => {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT key, value FROM project_settings`,
  );
  const result = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in result) {
      (result as Record<string, unknown>)[row.key] = row.value;
    }
  }
  result['llm.rag_max_examples'] = clampRagMaxExamples(result['llm.rag_max_examples']);
  result['voice.tts_max_parallel_fish_speech'] = clampTtsMaxParallel(
    result['voice.tts_max_parallel_fish_speech'],
  );
  result['llm.vllm_servers'] = normalizeVllmServerEntries(result['llm.vllm_servers']);
  result['voice.game_tts'] = normalizeGameTtsSettings(result['voice.game_tts']);
  result['pipeline.dependency_wait_timeout_sec'] = clampDependencyWaitTimeoutSec(
    result['pipeline.dependency_wait_timeout_sec'],
  );
  result['pipeline.health_check_interval_sec'] = clampHealthCheckIntervalSec(
    result['pipeline.health_check_interval_sec'],
  );
  return result;
};

/**
 * Fetches a single project setting value, returning the default if not set.
 *
 * @param db  - Database connection or pool.
 * @param key - Setting key to read.
 * @returns The persisted value or the default for that key.
 */
export const getProjectSetting = async <K extends ProjectSettingKey>(
  db: Tx,
  key: K,
): Promise<ProjectSettings[K]> => {
  const { rows } = await db.query<{ value: unknown }>(
    `SELECT value FROM project_settings WHERE key = $1`,
    [key],
  );
  if (rows.length === 0) return SETTING_DEFAULTS[key];
  if (key === 'voice.game_tts') {
    return normalizeGameTtsSettings(rows[0].value) as ProjectSettings[K];
  }
  return rows[0].value as ProjectSettings[K];
};

/**
 * Upserts a project setting value in the database.
 *
 * Serialises `value` to JSONB.  The `updated_at` timestamp is refreshed on
 * every write so the UI can show when each setting was last changed.
 *
 * @param db    - Database connection or pool.
 * @param key   - Setting key to write.
 * @param value - New value (must match the type declared for `key`).
 */
export const setProjectSetting = async (
  db: Tx,
  key: ProjectSettingKey,
  value: ProjectSettings[ProjectSettingKey],
): Promise<void> => {
  let stored: ProjectSettings[ProjectSettingKey] = value;
  if (key === 'voice.tts_max_parallel_fish_speech') {
    stored = clampTtsMaxParallel(value as number) as ProjectSettings[ProjectSettingKey];
  }
  if (key === 'llm.vllm_servers') {
    stored = normalizeVllmServerEntries(value) as ProjectSettings[ProjectSettingKey];
  }
  if (key === 'voice.game_tts') {
    stored = normalizeGameTtsSettings(value) as ProjectSettings[ProjectSettingKey];
  }
  if (key === 'pipeline.dependency_wait_timeout_sec') {
    stored = clampDependencyWaitTimeoutSec(value as number);
  }
  if (key === 'pipeline.health_check_interval_sec') {
    stored = clampHealthCheckIntervalSec(value as number);
  }

  await db.query(
    `INSERT INTO project_settings(key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT(key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(stored)],
  );
};
