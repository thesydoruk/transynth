import Database from 'better-sqlite3';
import { CONFIG } from './config.js';

export type Tx = Database.Database;

export function openDb(): Tx {
  const db = new Database(CONFIG.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function runSchema(db: Tx, schemaSql: string) {
  db.exec(schemaSql);
}

export function upsertMod(db: Tx, name: string, absPath: string, versionHash: string): number {
  db.prepare(
    `INSERT INTO mods(name, abs_path, version_hash) VALUES (?,?,?)
     ON CONFLICT(name, version_hash) DO UPDATE SET abs_path=excluded.abs_path`
  ).run(name, absPath, versionHash);
  const row = db.prepare(`SELECT id FROM mods WHERE name=? AND version_hash=?`).get(name, versionHash) as {id: number} | undefined;
  if (!row) throw new Error(`Failed to upsert mod: ${name}`);
  return row.id;
}

export function upsertRecord(db: Tx, modId: number, signature: string, path: string, pathSimplified: string, edid: string|null, hashNorm: string|null, formidHex: string|null): number {
  db.prepare(
    `INSERT INTO records(mod_id, signature, path, path_simplified, edid, hash_norm, formid_hex)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(mod_id, signature, path) DO UPDATE SET
       path_simplified=excluded.path_simplified,
       edid=COALESCE(excluded.edid, records.edid),
       hash_norm=excluded.hash_norm,
       formid_hex=COALESCE(excluded.formid_hex, records.formid_hex)`
  ).run(modId, signature, path, pathSimplified, edid, hashNorm, formidHex);
  const row = db.prepare(`SELECT id FROM records WHERE mod_id=? AND signature=? AND path=?`).get(modId, signature, path) as {id: number} | undefined;
  if (!row) throw new Error(`Failed to upsert record: ${path}`);
  return row.id;
}

export function insertString(db: Tx, recordId: number, lang: string, textRaw: string, textNorm: string, sourceKind: string = 'export'): number {
  const info = db.prepare(
    `INSERT INTO strings(record_id, lang, text_raw, text_norm, source_kind) VALUES (?,?,?,?,?)`
  ).run(recordId, lang, textRaw, textNorm, sourceKind);
  return Number(info.lastInsertRowid);
}

export function addTranslation(db: Tx, srcStringId: number, targetLang: string, text: string, status: string, confidence: number|null, provenance: string, model?: string): number {
  db.prepare(
    `INSERT INTO translations(src_string_id, target_lang, text, status, confidence, provenance, model)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(src_string_id, target_lang, text) DO NOTHING`
  ).run(srcStringId, targetLang, text, status, confidence, provenance, model ?? null);
  const row = db.prepare(
    `SELECT id FROM translations WHERE src_string_id=? AND target_lang=? AND text=?`
  ).get(srcStringId, targetLang, text) as {id: number} | undefined;
  return row?.id ?? 0;
}

export function bestTranslation(db: Tx, srcStringId: number, targetLang: string) {
  return db.prepare(
    `SELECT id, text, status FROM translations
     WHERE src_string_id=? AND target_lang=?
     ORDER BY CASE status
       WHEN 'human' THEN 1
       WHEN 'tm'    THEN 2
       WHEN 'fuzzy' THEN 3
       WHEN 'auto'  THEN 4
       ELSE 5 END,
       COALESCE(confidence, 0) DESC,
       created_at DESC
     LIMIT 1`
  ).get(srcStringId, targetLang) as {id:number,text:string,status:string}|undefined;
}
