-- PostgreSQL schema for the Fallout 4 localizer

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS mods (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  abs_path TEXT,
  version_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS records (
  id SERIAL PRIMARY KEY,
  mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
  formid_hex TEXT,
  signature TEXT,
  path TEXT,
  path_simplified TEXT,
  edid TEXT,
  hash_norm TEXT,
  UNIQUE(mod_id, signature, path)
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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(text_raw, '') || ' ' || COALESCE(text_norm, ''))
  ) STORED
);

ALTER TABLE strings ADD COLUMN IF NOT EXISTS lstring_id INTEGER;
ALTER TABLE strings ADD COLUMN IF NOT EXISTS text_norm_nopunct TEXT;

CREATE TABLE IF NOT EXISTS translations (
  id SERIAL PRIMARY KEY,
  src_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence DOUBLE PRECISION,
  provenance TEXT,
  model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(src_string_id, target_lang, text)
);

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

CREATE TABLE IF NOT EXISTS alignments (
  id SERIAL PRIMARY KEY,
  en_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  uk_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  score DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_hash)
);

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
  esp_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(file_hash)
);

-- Indices
CREATE UNIQUE INDEX IF NOT EXISTS idx_mods_name_version ON mods(name, version_hash);
CREATE INDEX IF NOT EXISTS idx_records_mod ON records(mod_id);
CREATE INDEX IF NOT EXISTS idx_records_anchors ON records(edid, signature, path_simplified, hash_norm);
CREATE INDEX IF NOT EXISTS idx_strings_record ON strings(record_id);
CREATE INDEX IF NOT EXISTS idx_strings_lang ON strings(lang);
CREATE INDEX IF NOT EXISTS idx_strings_lstring_lang ON strings(lang, lstring_id);
CREATE INDEX IF NOT EXISTS idx_strings_tsv ON strings USING GIN(tsv);
CREATE INDEX IF NOT EXISTS idx_strings_text_norm ON strings USING HASH(text_norm);
CREATE INDEX IF NOT EXISTS idx_strings_text_norm_nopunct ON strings USING HASH(text_norm_nopunct);
CREATE INDEX IF NOT EXISTS idx_strings_trgm_text_norm ON strings USING GIN(text_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_translations_by_lang ON translations(target_lang, status);
CREATE INDEX IF NOT EXISTS idx_translation_revisions_string_lang ON translation_revisions(src_string_id, target_lang, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_issues_string_lang ON qa_issues(src_string_id, target_lang, is_active);

-- ── Auth & collaboration tables ─────────────────────────────────────────────
-- These tables always exist regardless of MULTI_USER setting.
-- In single-user mode they simply hold the default admin row.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'translator',  -- admin | translator | reviewer
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,          -- e.g. login, translate, import, approve, export
  entity_type TEXT,              -- e.g. mod, string, translation, glossary
  entity_id INTEGER,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default admin user (password: "admin" — change on first login in multi-user mode).
-- The password hash is generated at runtime by dbInit.ts; this INSERT is a no-op placeholder.
INSERT INTO users (id, username, display_name, password_hash, role)
VALUES (1, 'admin', 'Administrator', '__PLACEHOLDER__', 'admin')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions USING HASH(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action, created_at DESC);
