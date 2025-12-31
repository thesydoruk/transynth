PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS mods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  abs_path TEXT,
  version_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
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
  id INTEGER PRIMARY KEY,
  record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  lang TEXT NOT NULL,
  text_raw TEXT NOT NULL,
  text_norm TEXT,
  source_kind TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS translations (
  id INTEGER PRIMARY KEY,
  src_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL,
  confidence REAL,
  provenance TEXT,
  model TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(src_string_id, target_lang, text)
);

CREATE TABLE IF NOT EXISTS alignments (
  id INTEGER PRIMARY KEY,
  en_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  uk_string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  score REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS glossary (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  lang TEXT NOT NULL,
  count INTEGER DEFAULT 1,
  source TEXT,
  UNIQUE(term, lang)
);

CREATE TABLE IF NOT EXISTS kv_cache (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS strings_fts USING fts5(
  text_raw, text_norm, content='strings', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS strings_ai AFTER INSERT ON strings BEGIN
  INSERT INTO strings_fts(rowid,text_raw,text_norm) VALUES (new.id,new.text_raw,new.text_norm);
END;
CREATE TRIGGER IF NOT EXISTS strings_ad AFTER DELETE ON strings BEGIN
  INSERT INTO strings_fts(strings_fts, rowid, text_raw, text_norm) VALUES('delete',old.id,old.text_raw,old.text_norm);
END;
CREATE TRIGGER IF NOT EXISTS strings_au AFTER UPDATE ON strings BEGIN
  INSERT INTO strings_fts(strings_fts, rowid, text_raw, text_norm) VALUES('delete',old.id,old.text_raw,old.text_norm);
  INSERT INTO strings_fts(rowid,text_raw,text_norm) VALUES (new.id,new.text_raw,new.text_norm);
END;

CREATE INDEX IF NOT EXISTS idx_records_mod ON records(mod_id);
CREATE INDEX IF NOT EXISTS idx_records_anchors ON records(edid, signature, path_simplified, hash_norm);
CREATE INDEX IF NOT EXISTS idx_strings_record ON strings(record_id);
CREATE INDEX IF NOT EXISTS idx_strings_lang ON strings(lang);
CREATE INDEX IF NOT EXISTS idx_translations_by_lang ON translations(target_lang, status);
