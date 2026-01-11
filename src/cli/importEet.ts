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
import { openDb, runSchema, closeDb, upsertMod, upsertRecord, insertString, addTranslation, type Tx } from '../db.js';
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

async function getOrCreateImportJob(db: Tx, fileName: string, fileHash: string, modId: number, totalRecords: number, srcLang: string, tgtLang: string): Promise<ImportJob> {
  const { rows: existingRows } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [fileHash]);
  const existing = existingRows[0] as ImportJob | undefined;
  if (existing) {
    if (existing.status === 'completed') {
      log.info(`File ${fileName} already fully imported (${existing.total_records} records). Skipping.`);
    }
    return existing;
  }

  await db.query(
    `INSERT INTO eet_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES ($1, $2, $3, $4, 'in_progress', $5, $6)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang],
  );

  const { rows } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ImportJob;
}

async function updateImportProgress(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE eet_imports SET imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function markImportDone(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE eet_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function markImportFailed(db: Tx, jobId: number, importedRecords: number) {
  await db.query(
    `UPDATE eet_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
}

async function importRecord(db: Tx, modId: number, rec: EetRecord, srcLang: string, tgtLang: string) {
  const recPath = rec.field || 'FULL';
  const pathSimplified = recPath;
  const hashNorm = normalizeForHash(rec.source);

  const recordId = await upsertRecord(db, modId, rec.signature, recPath, pathSimplified, rec.edid || null, hashNorm, rec.formId || null);

  const srcNorm = normalizeForHash(rec.source);
  const srcStringId = await insertString(db, recordId, srcLang, rec.source, srcNorm, 'eet');

  if (rec.target) {
    const status = rec.status === 0x63 ? 'human' : 'auto';
    await addTranslation(db, srcStringId, tgtLang, rec.target, status, rec.status === 0x63 ? 1.0 : 0.5, 'eet');
  }
}

async function importEetFile(db: Tx, filePath: string, srcLang: string, tgtLang: string) {
  const absPath = path.resolve(filePath);
  const fileName = path.basename(absPath);

  log.info(`Reading ${absPath} ...`);
  const buf = fs.readFileSync(absPath);
  const fileHash = sha1Hex(buf);

  const header = parseEetHeader(buf);
  log.info(`EET v${header.version}, game="${header.gameName}", declared records=${header.declaredCount}`);

  let totalRecords = header.declaredCount;
  if (totalRecords < 0) {
    let count = 0;
    for (const _rec of iterEetRecords(buf, header.recordsOffset)) count++;
    totalRecords = count;
  }

  const modName = fileName.replace(/\.eet$/i, '');
  const modId = await upsertMod(db, modName, absPath, fileHash);

  const job = await getOrCreateImportJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
  if (job.status === 'completed') return;

  const skipCount = job.imported_records;
  log.info(`Import job #${job.id}: ${job.imported_records}/${totalRecords} done, resuming from record ${skipCount}`);

  let processed = 0;
  let imported = job.imported_records;
  let batchCount = 0;
  let inTx = false;

  try {
    for (const rec of iterEetRecords(buf, header.recordsOffset)) {
      processed++;

      if (processed <= skipCount) continue;

      if (!inTx) {
        await db.query('BEGIN');
        inTx = true;
        batchCount = 0;
      }

      await importRecord(db, modId, rec, srcLang, tgtLang);
      imported++;
      batchCount++;

      if (batchCount >= BATCH_SIZE) {
        await updateImportProgress(db, job.id, imported);
        await db.query('COMMIT');
        inTx = false;
        if (imported % 10000 === 0 || imported === totalRecords) {
          log.info(`  progress: ${imported}/${totalRecords} records`);
        }
      }
    }

    if (inTx) {
      await db.query('COMMIT');
      inTx = false;
    }

    await markImportDone(db, job.id, imported);
    log.info(`Import complete: ${imported} records from ${fileName}`);
  } catch (err) {
    if (inTx) {
      try { await db.query('ROLLBACK'); } catch { /* ignore rollback errors */ }
    }
    await markImportFailed(db, job.id, imported);
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
  await runSchema(db, schemaSql);

  if (values.file) {
    await importEetFile(db, values.file as string, values.srcLang as string, values.tgtLang as string);
  } else {
    const dir = path.resolve(values.dir as string);
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
      await importEetFile(db, path.join(dir, f), values.srcLang as string, values.tgtLang as string);
    }
  }

  await closeDb();
  log.info('Done.');
}

main().catch(err => {
  log.error(err);
  process.exit(1);
});
