#!/usr/bin/env tsx
/**
 * importEet.ts — Import .eet (ESP-ESM Translator) files into the localizer DB.
 *
 * Files are expected in a folder (default: ./eet-inbox/).
 * Each file is parsed, and translation pairs are stored in the DB.
 * Import progress is tracked in the eet_imports table for resumability.
 *
 * Usage:
 *   tsx src/cli/importEet.ts --dir ./eet-inbox
 *   tsx src/cli/importEet.ts --file path/to/translations.eet
 *   tsx src/cli/importEet.ts --file translations.eet --srcLang en --tgtLang ru
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDb, runSchema, upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db.js';
import { parseEetHeader, iterEetRecords, type EetRecord } from '../bethesda/eetReader.js';
import { sha1Hex } from '../utils/hash.js';
import { normalizeForHash } from '../utils/textNorm.js';
import { log } from '../logger.js';

const BATCH_SIZE = 1000;

interface ImportJob {
  id: number;
  file_hash: string;
  mod_id: number;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
}

function ensureImportSchema(db: Tx) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eet_imports (
      id INTEGER PRIMARY KEY,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
      total_records INTEGER NOT NULL DEFAULT 0,
      imported_records INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      src_lang TEXT NOT NULL DEFAULT 'en',
      tgt_lang TEXT NOT NULL DEFAULT 'uk',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(file_hash)
    );
  `);
}

function getOrCreateImportJob(db: Tx, fileName: string, fileHash: string, modId: number, totalRecords: number, srcLang: string, tgtLang: string): ImportJob {
  const existing = db.prepare('SELECT * FROM eet_imports WHERE file_hash = ?').get(fileHash) as ImportJob | undefined;
  if (existing) {
    if (existing.status === 'completed') {
      log.info(`File ${fileName} already fully imported (${existing.total_records} records). Skipping.`);
    }
    return existing;
  }

  db.prepare(
    `INSERT INTO eet_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`
  ).run(fileName, fileHash, modId, totalRecords, srcLang, tgtLang);

  return db.prepare('SELECT * FROM eet_imports WHERE file_hash = ?').get(fileHash) as ImportJob;
}

function updateImportProgress(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function markImportDone(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET status = 'completed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function markImportFailed(db: Tx, jobId: number, importedRecords: number) {
  db.prepare(
    `UPDATE eet_imports SET status = 'failed', imported_records = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(importedRecords, jobId);
}

function importRecord(db: Tx, modId: number, rec: EetRecord, srcLang: string, tgtLang: string) {
  // Use edid + field tag as path, matching the record schema pattern
  const recPath = rec.field || 'FULL';
  const pathSimplified = recPath;
  const hashNorm = normalizeForHash(rec.source);

  const recordId = upsertRecord(db, modId, rec.signature, recPath, pathSimplified, rec.edid || null, hashNorm, rec.formId || null);

  // Insert source string
  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = insertString(db, recordId, srcLang, rec.source, srcNorm, 'eet');

  // Insert translation if present
  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'eet');
  }
}

function importEetFile(db: Tx, filePath: string, srcLang: string, tgtLang: string) {
  const absPath = path.resolve(filePath);
  const fileName = path.basename(absPath);

  log.info(`Reading ${absPath} ...`);
  const buf = fs.readFileSync(absPath);
  const fileHash = sha1Hex(buf);

  // Parse header
  const header = parseEetHeader(buf);
  log.info(`EET v${header.version}, game="${header.gameName}", declared records=${header.declaredCount}`);

  // Count total records via iteration (v1 has no declared count)
  let totalRecords = header.declaredCount;
  if (totalRecords < 0) {
    let count = 0;
    for (const _rec of iterEetRecords(buf, header.recordsOffset)) count++;
    totalRecords = count;
  }

  // Create mod entry
  const modName = fileName.replace(/\.eet$/i, '');
  const modId = upsertMod(db, modName, absPath, fileHash);

  // Create or resume import job
  const job = getOrCreateImportJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
  if (job.status === 'completed') return;

  const skipCount = job.imported_records;
  log.info(`Import job #${job.id}: ${job.imported_records}/${totalRecords} done, resuming from record ${skipCount}`);

  let processed = 0;
  let imported = job.imported_records;
  let batchCount = 0;

  const runBatch = db.transaction(() => {
    // placeholder — actual inserts happen inside the loop
  });

  // We'll use a manual transaction approach: open transaction, do BATCH_SIZE inserts, commit
  let inTx = false;

  try {
    for (const rec of iterEetRecords(buf, header.recordsOffset)) {
      processed++;

      // Skip already-imported records
      if (processed <= skipCount) continue;

      if (!inTx) {
        db.exec('BEGIN');
        inTx = true;
        batchCount = 0;
      }

      importRecord(db, modId, rec, srcLang, tgtLang);
      imported++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        updateImportProgress(db, job.id, imported);
        db.exec('COMMIT');
        inTx = false;
        if (imported % 10000 === 0 || imported === totalRecords) {
          log.info(`  progress: ${imported}/${totalRecords} records`);
        }
      }
    }

    // Commit remaining batch
    if (inTx) {
      db.exec('COMMIT');
      inTx = false;
    }

    markImportDone(db, job.id, imported);
    log.info(`Import complete: ${imported} records from ${fileName}`);
  } catch (err) {
    if (inTx) {
      try { db.exec('ROLLBACK'); } catch { /* ignore rollback errors */ }
    }
    markImportFailed(db, job.id, imported);
    throw err;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      dir: { type: 'string', default: './eet-inbox' },
      srcLang: { type: 'string', default: 'en' },
      tgtLang: { type: 'string', default: 'uk' },
    },
    strict: false,
  });

  const schemaSql = fs.readFileSync(new URL('../../sql/schema.sql', import.meta.url), 'utf-8');
  const db = openDb();
  runSchema(db, schemaSql);
  ensureImportSchema(db);

  if (values.file) {
    importEetFile(db, values.file, values.srcLang!, values.tgtLang!);
  } else {
    const dir = path.resolve(values.dir!);
    if (!fs.existsSync(dir)) {
      log.warn(`Directory ${dir} does not exist. Creating it.`);
      fs.mkdirSync(dir, { recursive: true });
      log.info(`Place .eet files into ${dir} and run again.`);
      return;
    }

    const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.eet'));
    if (files.length === 0) {
      log.info(`No .eet files found in ${dir}`);
      return;
    }

    log.info(`Found ${files.length} .eet file(s) in ${dir}`);
    for (const f of files) {
      importEetFile(db, path.join(dir, f), values.srcLang!, values.tgtLang!);
    }
  }

  db.close();
  log.info('Done.');
}

main().catch(err => {
  log.error(err);
  process.exit(1);
});
