-- PostgreSQL schema for the Fallout 4 localizer

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS mods (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  abs_path TEXT,
  version_hash TEXT,
  game TEXT NOT NULL DEFAULT 'fo4',  -- fo4 | fo76 | fo3 | fnv | sse | sle
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: add game column if it does not yet exist (idempotent).
ALTER TABLE mods ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'fo4';

-- Migration: Nexus Mods linkage columns — allow linking a local mod to its
-- NexusMods counterpart so both local and Nexus data merge into one view.
ALTER TABLE mods ADD COLUMN IF NOT EXISTS nexus_mod_id INTEGER;
ALTER TABLE mods ADD COLUMN IF NOT EXISTS nexus_name TEXT;
ALTER TABLE mods ADD COLUMN IF NOT EXISTS nexus_thumbnail TEXT;

-- Migration: drop cached mod stats tables (stats are computed on read).
DROP TABLE IF EXISTS mod_sig_status_stats;
DROP TABLE IF EXISTS mod_lang_stats;

CREATE TABLE IF NOT EXISTS records (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT NOT NULL DEFAULT '',
  signature TEXT,
  path TEXT,
  path_simplified TEXT,
  edid TEXT,
  hash_norm TEXT,
  UNIQUE(mod_id, signature, path, formid_hex)
);

CREATE TABLE IF NOT EXISTS strings (
  id SERIAL PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  lstring_id INTEGER,
  text_raw TEXT NOT NULL,
  text_norm TEXT,
  text_norm_nopunct TEXT,
  source_kind TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE strings ADD COLUMN IF NOT EXISTS lstring_id INTEGER;
ALTER TABLE strings ADD COLUMN IF NOT EXISTS text_norm_nopunct TEXT;
ALTER TABLE strings ADD COLUMN IF NOT EXISTS context TEXT;

-- ── Dialogue graph tables (DIAL/INFO tree mode) ────────────────────────────

CREATE TABLE IF NOT EXISTS dialog_topics (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT NOT NULL,
  edid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mod_id, formid_hex)
);

CREATE TABLE IF NOT EXISTS dialog_nodes (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES dialog_topics(id) ON DELETE CASCADE,
  info_formid_hex TEXT NOT NULL,
  speaker_formid_hex TEXT,
  speaker_name TEXT,
  previous_info_formid_hex TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(topic_id, info_formid_hex)
);

-- Node text is resolved at query time from records/strings (INFO\NAM1 responses
-- and INFO\RNAM prompts). A single cached string pointer could hold only one of
-- them and could not represent INFOs with several responses.
ALTER TABLE dialog_nodes DROP COLUMN IF EXISTS response_string_id;

CREATE TABLE IF NOT EXISTS dialog_edges (
  id SERIAL PRIMARY KEY,
  topic_id INTEGER NOT NULL REFERENCES dialog_topics(id) ON DELETE CASCADE,
  from_info_formid_hex TEXT NOT NULL,
  to_info_formid_hex TEXT NOT NULL,
  edge_kind TEXT NOT NULL DEFAULT 'previous',
  confidence TEXT NOT NULL DEFAULT 'exact',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(topic_id, from_info_formid_hex, to_info_formid_hex, edge_kind)
);

-- ── Scene tables (SCEN-based multi-topic dialog sequences) ──────────────────

CREATE TABLE IF NOT EXISTS dialog_scenes (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT NOT NULL,
  edid TEXT,
  quest_formid_hex TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mod_id, formid_hex)
);

CREATE TABLE IF NOT EXISTS dialog_scene_phases (
  id SERIAL PRIMARY KEY,
  scene_id INTEGER NOT NULL REFERENCES dialog_scenes(id) ON DELETE CASCADE,
  phase_order INTEGER NOT NULL,
  alias_id INTEGER NOT NULL DEFAULT 0,
  topic_id INTEGER NOT NULL REFERENCES dialog_topics(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(scene_id, phase_order, topic_id)
);

-- ── Quest / branch structure (QUST + DLBR ownership of DIAL topics) ─────────
-- Conversations group by quest; branches are Creation Kit dialog branches
-- (DLBR) that own one or more DIAL topics via DIAL\BNAM / DIAL\QNAM.

CREATE TABLE IF NOT EXISTS dialog_quests (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT NOT NULL,
  edid TEXT,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mod_id, formid_hex)
);

CREATE TABLE IF NOT EXISTS dialog_quest_stages (
  id SERIAL PRIMARY KEY,
  quest_id INTEGER NOT NULL REFERENCES dialog_quests(id) ON DELETE CASCADE,
  stage_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(quest_id, stage_index)
);

CREATE TABLE IF NOT EXISTS dialog_branches (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT NOT NULL,
  edid TEXT,
  quest_formid_hex TEXT,
  start_topic_formid_hex TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mod_id, formid_hex)
);

ALTER TABLE dialog_topics ADD COLUMN IF NOT EXISTS quest_formid_hex TEXT;
ALTER TABLE dialog_topics ADD COLUMN IF NOT EXISTS branch_formid_hex TEXT;

-- ── Dialog speakers (grammatical gender of participants) ────────────────────
-- Ukrainian marks gender on past-tense verbs and predicative adjectives, so a
-- line cannot be translated or voiced correctly without knowing the sex of the
-- speaker and of whoever they address.
--
-- A speaker is keyed either by its actor record (`npc:0001A2B3`, from INFO\ANAM)
-- or by its voice folder (`voice:FemaleBoston`), because quest-alias dialog
-- carries no actor reference and can only be attributed to the folder its audio
-- ships in.

CREATE TABLE IF NOT EXISTS dialog_speakers (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  speaker_key TEXT NOT NULL,
  display_name TEXT,
  voice_type TEXT,
  -- The player character, whose gender is chosen in-game and never fixed.
  is_player BOOLEAN NOT NULL DEFAULT FALSE,
  -- male | female | any | unknown, resolved during import.
  detected_gender TEXT NOT NULL DEFAULT 'unknown',
  -- plugin | voice_type | player
  detected_source TEXT,
  -- Set in the speakers editor; always wins over detection.
  gender_override TEXT,
  line_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mod_id, speaker_key)
);

CREATE INDEX IF NOT EXISTS idx_dialog_speakers_mod ON dialog_speakers(mod_id);

-- Speaker identity and addressee of each node, resolved once per import.
ALTER TABLE dialog_nodes ADD COLUMN IF NOT EXISTS speaker_key TEXT;
-- player | npc | unknown
ALTER TABLE dialog_nodes ADD COLUMN IF NOT EXISTS addressee_kind TEXT;
ALTER TABLE dialog_nodes ADD COLUMN IF NOT EXISTS addressee_speaker_key TEXT;

-- Translation and QA resolve a node from an INFO FormID alone.
CREATE INDEX IF NOT EXISTS idx_dialog_nodes_info_formid ON dialog_nodes(info_formid_hex);

-- ── Activity attribution ──────────────────────────────────────────────────────
-- Single built-in user row for activity log and translation attribution.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Remove legacy multi-user auth schema (sessions, password columns).
DROP TABLE IF EXISTS sessions;
DROP INDEX IF EXISTS idx_sessions_token;
DROP INDEX IF EXISTS idx_sessions_expiry;
ALTER TABLE users DROP COLUMN IF EXISTS username;
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;
ALTER TABLE users DROP COLUMN IF EXISTS role;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;
ALTER TABLE users DROP COLUMN IF EXISTS updated_at;

CREATE TABLE IF NOT EXISTS translations (
  id SERIAL PRIMARY KEY,
  src_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  provenance TEXT,
  model TEXT,
  -- Linked to the user who last saved this translation manually. NULL for automated flows.
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Exactly one translation per (source string, target language). The editor
-- save path is DELETE+INSERT and imports upsert on this key, so a pair never
-- holds more than one row. This lets the grid join translations directly
-- instead of picking a "best" row per source string.
--
-- The unique index itself is created by the migration at the END of this file,
-- because existing databases must first de-duplicate any legacy rows before
-- the (src_string_id, target_lang) uniqueness can be enforced.

CREATE TABLE IF NOT EXISTS translation_revisions (
  id SERIAL PRIMARY KEY,
  src_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  translation_id INTEGER REFERENCES translations(id) ON DELETE SET NULL,
  target_lang TEXT NOT NULL,
  text TEXT,
  status TEXT NOT NULL,
  provenance TEXT,
  model TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qa_issues (
  id SERIAL PRIMARY KEY,
  src_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  translation_id INTEGER REFERENCES translations(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configurable QA validation rules (forbidden characters, max length per GRUP/field).
-- Each rule targets a specific game and optionally a record signature and/or path.
-- rule_type: 'forbidden_chars' — value contains the forbidden character set.
-- rule_type: 'max_length'      — value contains the maximum character count (integer string).
CREATE TABLE IF NOT EXISTS qa_rules (
  id SERIAL PRIMARY KEY,
  game TEXT NOT NULL DEFAULT 'fo4',
  rule_type TEXT NOT NULL CHECK (rule_type IN ('forbidden_chars', 'max_length')),
  signature TEXT,
  path TEXT,
  value TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qa_rules_game_type ON qa_rules(game, rule_type) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS glossary (
  id SERIAL PRIMARY KEY,
  term TEXT NOT NULL,
  translation TEXT,
  src_lang TEXT NOT NULL DEFAULT 'en',
  tgt_lang TEXT NOT NULL DEFAULT 'uk',
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(term, src_lang, tgt_lang)
);

-- Migration: glossary term→pair model
ALTER TABLE glossary ADD COLUMN IF NOT EXISTS translation TEXT;
ALTER TABLE glossary ADD COLUMN IF NOT EXISTS src_lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE glossary ADD COLUMN IF NOT EXISTS tgt_lang TEXT NOT NULL DEFAULT 'uk';
ALTER TABLE glossary ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
-- Drop old constraint and columns if they exist
ALTER TABLE glossary DROP CONSTRAINT IF EXISTS glossary_term_lang_key;
ALTER TABLE glossary DROP COLUMN IF EXISTS lang;
ALTER TABLE glossary DROP COLUMN IF EXISTS count;
CREATE UNIQUE INDEX IF NOT EXISTS glossary_term_src_tgt_key ON glossary(term, src_lang, tgt_lang);

CREATE TABLE IF NOT EXISTS eet_imports (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  src_lang TEXT NOT NULL DEFAULT 'en',
  tgt_lang TEXT NOT NULL DEFAULT 'uk',
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_hash)
);
-- Idempotent migration: add last_error column to existing databases
ALTER TABLE eet_imports ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE TABLE IF NOT EXISTS csv_imports (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  src_lang TEXT NOT NULL DEFAULT 'en',
  tgt_lang TEXT NOT NULL DEFAULT 'uk',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_hash)
);

CREATE TABLE IF NOT EXISTS mod_imports (
  id SERIAL PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
  total_records INTEGER NOT NULL DEFAULT 0,
  imported_records INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  src_lang TEXT NOT NULL DEFAULT 'en',
  tgt_lang TEXT NOT NULL DEFAULT 'uk',
  is_localized INTEGER NOT NULL DEFAULT 0,
  game TEXT NOT NULL DEFAULT 'fo4',  -- fo4 | fo76 | fo3 | fnv | sse | sle
  esp_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_hash)
);

-- Migration: add game column to mod_imports if it does not yet exist.
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'fo4';
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_id INTEGER;
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS source_folder TEXT;
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS nexus_mod_name TEXT;
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS extract_dir TEXT;
ALTER TABLE mod_imports ADD COLUMN IF NOT EXISTS archive_manifest JSONB;

-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS idx_mods_name_version ON mods(name, version_hash);
CREATE INDEX IF NOT EXISTS idx_mods_game ON mods(game);
CREATE INDEX IF NOT EXISTS idx_records_mod ON records(mod_id);
CREATE INDEX IF NOT EXISTS idx_records_edid ON records(edid) WHERE edid IS NOT NULL AND edid <> '';
CREATE INDEX IF NOT EXISTS idx_records_hash_norm ON records USING HASH(hash_norm) WHERE hash_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_strings_record ON strings(record_id);
CREATE INDEX IF NOT EXISTS idx_strings_lang ON strings(lang);
CREATE INDEX IF NOT EXISTS idx_strings_lstring_lang ON strings(lang, lstring_id);
CREATE INDEX IF NOT EXISTS idx_strings_text_norm ON strings USING HASH(text_norm);
-- B-tree (lang, text_norm) exceeds PG btree row limit (~2704 B) for long EET/plugin strings.
-- Equality on text_norm uses idx_strings_text_norm (HASH); lang is filtered separately.
DROP INDEX IF EXISTS idx_strings_lang_text_norm;
CREATE INDEX IF NOT EXISTS idx_strings_text_norm_nopunct ON strings USING HASH(text_norm_nopunct);
CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_norm ON strings USING GIN(text_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_translations_by_lang ON translations(target_lang, status);
CREATE INDEX IF NOT EXISTS idx_translation_revisions_string_lang ON translation_revisions(src_string_id, target_lang, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_translation_revisions_translation_id ON translation_revisions(translation_id);
CREATE INDEX IF NOT EXISTS idx_qa_issues_string_lang ON qa_issues(src_string_id, target_lang, is_active);
CREATE INDEX IF NOT EXISTS idx_qa_issues_translation_id ON qa_issues(translation_id);

-- Mod editor string grid: join path (records.mod_id + strings.lang)
CREATE INDEX IF NOT EXISTS idx_strings_record_lang ON strings(record_id, lang);

-- Mod editor sort (B-tree; mod_id is always filtered in listStrings)
CREATE INDEX IF NOT EXISTS idx_records_mod_signature_path ON records(mod_id, signature, path);
CREATE INDEX IF NOT EXISTS idx_records_mod_formid ON records(mod_id, formid_hex);
CREATE INDEX IF NOT EXISTS idx_records_mod_edid ON records(mod_id, edid);
CREATE INDEX IF NOT EXISTS idx_records_mod_path ON records(mod_id, path);
DROP INDEX IF EXISTS idx_records_mod_signature;
-- confidence is numeric; full text columns exceed btree row-size limits for sort indexes
CREATE INDEX IF NOT EXISTS idx_translations_lang_confidence ON translations(target_lang, confidence);

-- Mod editor column filters (ILIKE substring search via pg_trgm)
CREATE INDEX IF NOT EXISTS idx_records_trgm_signature ON records USING GIN (signature gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_trgm_formid ON records USING GIN (formid_hex gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_trgm_edid ON records USING GIN (edid gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_records_trgm_path ON records USING GIN (path gin_trgm_ops);
-- Source / original text (strings.text_raw) and translation text (translations.text)
CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_raw ON strings USING GIN (text_raw gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_translations_trgm_text ON translations USING GIN (text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_dialog_topics_mod ON dialog_topics(mod_id);
CREATE INDEX IF NOT EXISTS idx_dialog_nodes_topic ON dialog_nodes(topic_id);
CREATE INDEX IF NOT EXISTS idx_dialog_nodes_topic_info ON dialog_nodes(topic_id, info_formid_hex);
CREATE INDEX IF NOT EXISTS idx_dialog_nodes_info ON dialog_nodes(info_formid_hex);
DROP INDEX IF EXISTS idx_dialog_nodes_response_string;
CREATE INDEX IF NOT EXISTS idx_dialog_edges_topic_from ON dialog_edges(topic_id, from_info_formid_hex);
CREATE INDEX IF NOT EXISTS idx_dialog_scenes_mod ON dialog_scenes(mod_id);
CREATE INDEX IF NOT EXISTS idx_dialog_scene_phases_scene ON dialog_scene_phases(scene_id, phase_order);
CREATE INDEX IF NOT EXISTS idx_dialog_scene_phases_topic ON dialog_scene_phases(topic_id);
CREATE INDEX IF NOT EXISTS idx_dialog_quests_mod ON dialog_quests(mod_id);
CREATE INDEX IF NOT EXISTS idx_dialog_quest_stages_quest ON dialog_quest_stages(quest_id);
CREATE INDEX IF NOT EXISTS idx_dialog_branches_mod ON dialog_branches(mod_id);
CREATE INDEX IF NOT EXISTS idx_dialog_branches_quest ON dialog_branches(mod_id, quest_formid_hex);
CREATE INDEX IF NOT EXISTS idx_dialog_topics_quest ON dialog_topics(mod_id, quest_formid_hex);
CREATE INDEX IF NOT EXISTS idx_dialog_topics_branch ON dialog_topics(mod_id, branch_formid_hex);

-- ── Activity log ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,          -- e.g. login, translate, import, approve, export
  entity_type TEXT,              -- e.g. mod, string, translation, glossary
  entity_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO users (id, display_name)
VALUES (1, 'Default')
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS translation_cache CASCADE;

CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action, created_at DESC);

-- ── LLM batch translate jobs ─────────────────────────────────────────────────
-- Tracks lifecycle of each batch-translate operation so job history survives
-- page reloads. One row per batch: inserted when the request starts, updated
-- to completed or failed when the loop ends. Not a high-frequency table.
CREATE TABLE IF NOT EXISTS llm_jobs (
  id SERIAL PRIMARY KEY,
  /** FK to mods — nullable in case the mod is deleted later. */
  mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
  /** Snapshot of mods.game at insert time so history survives mod deletion. */
  mod_game TEXT,
  /** Snapshot of mods.name at insert time. */
  mod_name TEXT,
  /** Total strings in the batch. */
  string_count INTEGER NOT NULL DEFAULT 0,
  /** Strings translated so far (updated at completion, not per-string). */
  done_count INTEGER NOT NULL DEFAULT 0,
  /** running → completed | failed. */
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  /** Error message when status = 'failed'; null otherwise. */
  error TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_jobs_updated ON llm_jobs(updated_at DESC);

-- ── Project-level workflow settings ─────────────────────────────────────────
-- Stores persisted project-wide configuration as key→JSONB pairs.
-- Frontend reads/writes these via GET /api/project-settings and
-- PUT /api/project-settings/:key. Keys and defaults are defined in
-- src/web/projectSettings.ts.
CREATE TABLE IF NOT EXISTS project_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default values — ON CONFLICT DO NOTHING is idempotent and safe on
-- repeated schema runs (dbInit / dbReset).
INSERT INTO project_settings(key, value) VALUES
  ('workflow.auto_approve_on_save',    'false'),
  ('workflow.propagate_to_identical',  'true'),
  ('workflow.hide_ignored_by_default', 'false'),
  ('qa.end_punct_match',               'true'),
  ('qa.min_word_count',                '1'),
  ('import.skip_tes4',                 'false'),
  ('llm.rag_max_examples',             '5'),
  ('llm.rag_min_similarity',           '0.5')
ON CONFLICT(key) DO NOTHING;

-- ── Translation RAG index (pgvector) ────────────────────────────────────────
-- Stores embeddings of reviewed/human translations for few-shot LLM context.
-- Indexed rows are synced on translation save/status change (see src/llm/rag/sync.ts).
-- Drop legacy 1536-dim table when upgrading to Arctic Embed L v2.0 (1024-dim).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'translation_examples'
      AND n.nspname = 'public'
      AND a.attname = 'embedding'
      AND NOT a.attisdropped
      AND a.atttypmod = 1536
  ) THEN
    DROP INDEX IF EXISTS idx_translation_examples_hnsw;
    DROP TABLE translation_examples;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS translation_examples (
  translation_id   INTEGER PRIMARY KEY REFERENCES translations(id) ON DELETE CASCADE,
  src_string_id    INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  src_lang         TEXT NOT NULL,
  target_lang      TEXT NOT NULL,
  source_text      TEXT NOT NULL,
  translation_text TEXT NOT NULL,
  signature        TEXT,
  path             TEXT,
  game             TEXT,
  embed_model      TEXT NOT NULL,
  embedding        vector(1024) NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_translation_examples_langs
  ON translation_examples(src_lang, target_lang);

CREATE INDEX IF NOT EXISTS idx_translation_examples_hnsw
  ON translation_examples USING hnsw (embedding vector_cosine_ops);

-- ── String-level ignore flag ─────────────────────────────────────────────────
-- Marks individual source strings as intentionally excluded from translation
-- review. Ignored strings can be hidden in the editor via the
-- workflow.hide_ignored_by_default project setting.
ALTER TABLE strings ADD COLUMN IF NOT EXISTS is_ignored BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_strings_is_ignored ON strings(record_id, lang) WHERE is_ignored = TRUE;

-- Skip-detect audit timestamp: set when a row is scanned (keep or skip). NULL = not yet scanned.
ALTER TABLE strings ADD COLUMN IF NOT EXISTS skip_detect_scanned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_strings_skip_detect_pending
  ON strings(record_id, lang)
  WHERE skip_detect_scanned_at IS NULL AND is_ignored = FALSE;

-- ── Deprecated subsystem cleanup ─────────────────────────────────────────────
-- The TradAuto pattern-rule engine and the CSV `alignments` table were legacy
-- ports superseded by the LLM + RAG + glossary pipeline. Drop them so existing
-- databases converge with the current schema. Idempotent and safe to re-run.
DROP TABLE IF EXISTS tradauto_rules;
DROP TABLE IF EXISTS alignments;

-- ── Drop unused full-text search column ──────────────────────────────────────
-- The editor grid searches source/translation text via pg_trgm + ILIKE, never
-- full-text search. The generated `strings.tsv` column and its GIN index only
-- added per-insert CPU cost, write amplification, and storage during large-mod
-- imports. Remove them so existing databases converge. Dropping the column
-- cascades to the dependent index. Idempotent and safe to re-run.
DROP INDEX IF EXISTS idx_strings_tsv;
ALTER TABLE strings DROP COLUMN IF EXISTS tsv;

-- ── Enforce one translation per (source string, target language) ─────────────
-- The multi-row "best translation" model was legacy: the editor save path does
-- DELETE+INSERT, so a (string, lang) pair never legitimately holds more than
-- one translation. Keeping the old md5(text)-based uniqueness forced every grid
-- query (and especially the status filter) to pick a "best" row per source
-- string via a correlated subquery, which scanned the whole mod before LIMIT.
--
-- Collapse any historical duplicates — keeping the highest-priority status,
-- then confidence, then the most recent — and replace the md5(text) unique
-- index with a plain (src_string_id, target_lang) one. The grid can then join
-- translations directly, and ON CONFLICT(src_string_id, target_lang) upserts
-- become possible. Idempotent: after the first run no duplicates remain.
DELETE FROM translations dup
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY src_string_id, target_lang
           ORDER BY
             CASE status
               WHEN 'skip' THEN 0
               WHEN 'draft' THEN 1
               WHEN 'reviewed' THEN 2
               WHEN 'human' THEN 3
               WHEN 'tm' THEN 4
               WHEN 'fuzzy' THEN 5
               WHEN 'auto' THEN 6
               WHEN 'rejected' THEN 7
               ELSE 8
             END,
             COALESCE(confidence, 0) DESC,
             created_at DESC
         ) AS rn
  FROM translations
) ranked
WHERE dup.id = ranked.id AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS translations_src_string_id_target_lang_key
  ON translations(src_string_id, target_lang);

DROP INDEX IF EXISTS translations_src_string_id_target_lang_text_key;

-- ── Per-speaker TTS reference picks ───────────────────────────────────────────
-- Stores which voiced line (formid + variant) is used as the speaker_wav
-- reference for each NPC voice folder. Auto-selected on first localize run;
-- editable from the editor voice modal.
CREATE TABLE IF NOT EXISTS voice_speaker_refs (
  mod_id        INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  speaker_key   TEXT NOT NULL,
  formid_lower6 TEXT NOT NULL,
  variant       INTEGER NOT NULL CHECK (variant >= 1),
  auto_score    DOUBLE PRECISION,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (mod_id, speaker_key)
);

CREATE INDEX IF NOT EXISTS idx_voice_speaker_refs_mod
  ON voice_speaker_refs(mod_id);

-- ── Voice synthesis text versioning ───────────────────────────────────────────
-- Tracks a hash of the text fields sent to Fish Speech so stale `.fuz` files
-- are regenerated when translation or speaker_text changes.
CREATE TABLE IF NOT EXISTS voice_synthesis_state (
  mod_id           INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_lower6    TEXT NOT NULL,
  variant          INTEGER NOT NULL CHECK (variant >= 1),
  target_lang      TEXT NOT NULL,
  tts_text_version TEXT NOT NULL,
  synthesized_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (mod_id, formid_lower6, variant, target_lang)
);

CREATE INDEX IF NOT EXISTS idx_voice_synthesis_state_mod_lang
  ON voice_synthesis_state(mod_id, target_lang);

-- ── Narrator gender (BOOK/TERM/NOTE) ─────────────────────────────────────────
ALTER TABLE records ADD COLUMN IF NOT EXISTS narrator_gender TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS narrator_gender_source TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS narrator_gender_override TEXT;
ALTER TABLE records ADD COLUMN IF NOT EXISTS gender_detect_scanned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_records_gender_detect_pending
  ON records(mod_id)
  WHERE gender_detect_scanned_at IS NULL
    AND signature IN ('BOOK', 'TERM', 'NOTE');
