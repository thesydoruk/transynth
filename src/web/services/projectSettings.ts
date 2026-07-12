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
  /** When true, each voiced line uses its own English audio as the XTTS reference clip. */
  | 'voice.line_reference'
  /** TTS model backend sent as `backend` on POST /v1/synthesize. */
  | 'voice.backend'
  /** XTTS synthesis speed multiplier. */
  | 'voice.speed'
  /** XTTS length penalty — higher values shorten utterances. */
  | 'voice.length_penalty'
  /** XTTS sampling temperature. */
  | 'voice.temperature'
  /** XTTS repetition penalty. */
  | 'voice.repetition_penalty'
  /** XTTS nucleus sampling top-p (0–1). */
  | 'voice.top_p'
  /** XTTS top-k sampling. */
  | 'voice.top_k'
  /** When true, XTTS may split long text into multiple utterances. */
  | 'voice.enable_text_splitting';

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
  'voice.backend': 'xtts' | 'fish-speech';
  'voice.speed': number;
  'voice.length_penalty': number;
  'voice.temperature': number;
  'voice.repetition_penalty': number;
  'voice.top_p': number;
  'voice.top_k': number;
  'voice.enable_text_splitting': boolean;
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
  'voice.backend': 'xtts',
  'voice.speed': 1.0,
  'voice.length_penalty': 2,
  'voice.temperature': 0.65,
  'voice.repetition_penalty': 1.2,
  'voice.top_p': 0.8,
  'voice.top_k': 50,
  'voice.enable_text_splitting': false,
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
  await db.query(
    `INSERT INTO project_settings(key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT(key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
    [key, JSON.stringify(value)],
  );
};
