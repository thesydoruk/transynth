-- PostgreSQL schema for the Fallout 4 localizer

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
  source_kind TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tsv TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', COALESCE(text_raw, '') || ' ' || COALESCE(text_norm, ''))
  ) STORED
);

ALTER TABLE strings ADD COLUMN IF NOT EXISTS lstring_id INTEGER;

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
  lang TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  source TEXT,
  UNIQUE(term, lang)
);

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
CREATE INDEX IF NOT EXISTS idx_translations_by_lang ON translations(target_lang, status);
CREATE INDEX IF NOT EXISTS idx_translation_revisions_string_lang ON translation_revisions(src_string_id, target_lang, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_issues_string_lang ON qa_issues(src_string_id, target_lang, is_active);
