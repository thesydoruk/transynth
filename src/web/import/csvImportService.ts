/**
 * csvImportService.ts
 *
 * CSV import pipeline used by the web UI.
 *
 * This module ingests a CSV file exported by this tool (or compatible external
 * sources) into PostgreSQL:
 * - creates/updates a mod row (identified by file hash),
 * - upserts record rows keyed by (mod, signature, path, edid, formId),
 * - inserts source strings in `src_lang`,
 * - and optionally inserts a target translation row when `Target` is present.
 *
 * The implementation is resumable:
 * - each import is represented by a `csv_imports` job row,
 * - progress is tracked as `imported_records`,
 * - and pause/cancel requests are honoured between record writes.
 */
import { upsertMod, type Tx } from '../../db';
import { sha1Hex } from '../../utils/hash';
import { parseCsvLine } from '../../utils/csv';
import { log } from '../../logger';
import { CONFIG } from '../../config';
import { bulkInsertRecordImportRows } from './recordImportBulk';
import { withDeferredImportIndexes, withModImportWriteLock } from './modImportIndexes';

/**
 * Import job row stored in the `csv_imports` table.
 *
 * Jobs are keyed by the file hash so re-uploading the same file resumes the
 * existing job instead of creating duplicates.
 */
export interface CsvImportJob {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  created_at: string;
  updated_at: string;
}

/**
 * One logical translation row parsed from the uploaded CSV.
 *
 * The parser is tolerant to missing columns and uses sensible defaults so that
 * partially compatible CSV exports can still be imported.
 */
export interface CsvRecord {
  formId: string;
  signature: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
}

export type ProgressCb = (imported: number, total: number) => void;

// ── Schema ──────────────────────────────────────────────────────────────────

export const ensureCsvImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
};

// ── CRUD helpers ────────────────────────────────────────────────────────────

export const listCsvImportJobs = async (db: Tx): Promise<CsvImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM csv_imports ORDER BY created_at DESC');
  return rows as CsvImportJob[];
};

export const getCsvImportJob = async (db: Tx, id: number): Promise<CsvImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM csv_imports WHERE id = $1', [id]);
  return rows[0] as CsvImportJob | undefined;
};

export const updateCsvJobLanguages = async (
  db: Tx,
  id: number,
  srcLang: string,
  tgtLang: string,
) => {
  await db.query(
    `UPDATE csv_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
};

export const deleteCsvImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM csv_imports WHERE id = $1', [id]);
};

const getOrCreateJob = async (
  db: Tx,
  fileName: string,
  fileHash: string,
  modId: number,
  totalRecords: number,
  srcLang: string,
  tgtLang: string,
): Promise<CsvImportJob> => {
  const { rows: existing } = await db.query('SELECT * FROM csv_imports WHERE file_hash = $1', [
    fileHash,
  ]);
  if (existing[0]) return existing[0] as CsvImportJob;

  await db.query(
    `INSERT INTO csv_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang],
  );

  const { rows } = await db.query('SELECT * FROM csv_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as CsvImportJob;
};

const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

// ── CSV parsing ─────────────────────────────────────────────────────────────

const parseCsvRecordFields = (
  f: string[],
  cols: {
    iFormId: number;
    iSig: number;
    iEdid: number;
    iPath: number;
    iSource: number;
    iTarget: number;
    iStatus: number;
  },
): CsvRecord => {
  const statusRaw = cols.iStatus >= 0 ? (f[cols.iStatus] ?? '') : '';
  let statusByte = 0xff;
  if (statusRaw === 'confirmed') statusByte = 0x63;
  else if (statusRaw === 'untranslated') statusByte = 0xff;
  else if (/^\d+$/.test(statusRaw)) statusByte = Number(statusRaw);

  return {
    formId: cols.iFormId >= 0 ? (f[cols.iFormId] ?? '') : '',
    signature: cols.iSig >= 0 ? (f[cols.iSig] ?? '') : '',
    edid: cols.iEdid >= 0 ? (f[cols.iEdid] ?? '') : '',
    field: cols.iPath >= 0 ? (f[cols.iPath] ?? 'FULL') : 'FULL',
    source: cols.iSource >= 0 ? (f[cols.iSource] ?? '') : '',
    target: cols.iTarget >= 0 ? (f[cols.iTarget] ?? '') : '',
    status: statusByte,
  };
};

const parseCsvHeader = (headerLine: string) => {
  const cols = parseCsvLine(headerLine);
  const idx = (name: string) => cols.findIndex((c) => c.toLowerCase() === name.toLowerCase());
  return {
    cols,
    fields: {
      iFormId: idx('FormID'),
      iSig: idx('Signature'),
      iEdid: idx('EDID'),
      iPath: idx('Path'),
      iSource: idx('Source'),
      iTarget: idx('Target'),
      iStatus: idx('Status'),
    },
  };
};

/**
 * Parse CSV text into structured {@link CsvRecord} objects.
 *
 * The header row is used to locate columns by name (case-insensitive). Unknown
 * or missing columns are treated as empty strings / defaults.
 *
 * @param text - Full CSV file contents as UTF‑8 text.
 * @returns Parsed record list, excluding the header row.
 */
export const parseCsvRecords = (text: string): CsvRecord[] => {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const headerLine = lines.shift()!;
  const { fields } = parseCsvHeader(headerLine);

  const records: CsvRecord[] = [];
  for (const line of lines) {
    records.push(parseCsvRecordFields(parseCsvLine(line), fields));
  }
  return records;
};

/**
 * Iterate parsed CSV records one-by-one.
 *
 * This generator mirrors {@link parseCsvRecords} but yields records lazily so
 * callers can preview data without allocating the entire record list.
 *
 * @param text - Full CSV file contents as UTF‑8 text.
 * @yields {@link CsvRecord} values.
 */
export function* iterCsvRecords(text: string): Generator<CsvRecord> {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return;

  const headerLine = lines.shift()!;
  const { fields } = parseCsvHeader(headerLine);

  for (const line of lines) {
    yield parseCsvRecordFields(parseCsvLine(line), fields);
  }
}

/**
 * Register an uploaded CSV file by creating (or reusing) an import job row.
 *
 * This does not perform the import. Call {@link runCsvImport} to execute the
 * actual ingestion.
 *
 * @param db - Database handle.
 * @param fileName - Original uploaded file name (used for display/mod naming).
 * @param text - CSV file contents.
 * @param srcLang - Source language code for ingested strings.
 * @param tgtLang - Target language code for ingested translations.
 * @returns Created or existing job descriptor.
 */
export const registerCsvFile = async (
  db: Tx,
  fileName: string,
  text: string,
  srcLang = 'en',
  tgtLang = 'uk',
): Promise<CsvImportJob> => {
  const fileHash = sha1Hex(Buffer.from(text, 'utf8'));
  const records = parseCsvRecords(text);
  const totalRecords = records.length;

  const modName = fileName.replace(/\.csv$/i, '');
  const modId = await upsertMod(db, modName, `csv-upload/${fileName}`, fileHash);

  return getOrCreateJob(db, fileName, fileHash, modId, totalRecords, srcLang, tgtLang);
};

// ── Active import tracking ──────────────────────────────────────────────────

interface ActiveImport {
  cancel: boolean;
  pause: boolean;
}

const activeImports = new Map<number, ActiveImport>();

export const isCsvImportRunning = (jobId: number): boolean => {
  return activeImports.has(jobId);
};

export const requestCsvCancel = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.cancel = true;
};

export const requestCsvPause = (jobId: number) => {
  const state = activeImports.get(jobId);
  if (state) state.pause = true;
};

/**
 * Execute a CSV import job.
 *
 * The import resumes from `job.imported_records`. Progress is committed in
 * batches; between batches the job can be paused or cancelled.
 *
 * @param db - Database handle. The implementation uses explicit BEGIN/COMMIT.
 * @param job - Job row previously returned by {@link registerCsvFile}.
 * @param text - CSV file contents.
 * @param onProgress - Optional callback invoked after each committed batch.
 * @returns Final job state.
 */
export const runCsvImport = async (
  db: Tx,
  job: CsvImportJob,
  text: string,
  onProgress?: ProgressCb,
): Promise<CsvImportJob> => {
  if (job.status === 'completed') return job;
  if (activeImports.has(job.id)) throw new Error(`CSV Import #${job.id} is already running`);

  const state: ActiveImport = { cancel: false, pause: false };
  activeImports.set(job.id, state);

  const skipCount = job.imported_records;
  const importBatchSize = CONFIG.dbChunkSize;
  let processed = 0;
  let imported = job.imported_records;
  let inTx = false;
  const pending: CsvRecord[] = [];
  const startTime = Date.now();

  log.info(
    `[CSV Import #${job.id}] Starting import of "${job.file_name}" — ${job.total_records} records, resuming from ${skipCount} (batch=${importBatchSize}, deferIndexes=${CONFIG.modImportDeferIndexes})`,
  );

  const flushPendingBatch = async () => {
    if (pending.length === 0) return;
    await bulkInsertRecordImportRows(db, job.mod_id!, pending, job.src_lang, job.tgt_lang, {
      sourceKind: 'csv',
      provenance: 'csv',
    });
    imported += pending.length;
    pending.length = 0;
  };

  const commitOpenTx = async () => {
    if (inTx) {
      await db.query('COMMIT');
      inTx = false;
    }
  };

  try {
    await withModImportWriteLock(db, async () => {
      await withDeferredImportIndexes(db, CONFIG.modImportDeferIndexes, async () => {
        for (const rec of iterCsvRecords(text)) {
          processed++;
          if (processed <= skipCount) continue;

          if (state.cancel) {
            if (pending.length > 0) {
              if (!inTx) {
                await db.query('BEGIN');
                inTx = true;
              }
              await flushPendingBatch();
            }
            await commitOpenTx();
            await markFailed(db, job.id, imported);
            log.info(`CSV Import #${job.id} cancelled at ${imported}/${job.total_records}`);
            break;
          }
          if (state.pause) {
            if (pending.length > 0) {
              if (!inTx) {
                await db.query('BEGIN');
                inTx = true;
              }
              await flushPendingBatch();
            }
            await commitOpenTx();
            await markPaused(db, job.id, imported);
            log.info(`CSV Import #${job.id} paused at ${imported}/${job.total_records}`);
            break;
          }

          pending.push(rec);

          if (pending.length >= importBatchSize) {
            await db.query('BEGIN');
            inTx = true;
            await flushPendingBatch();
            await updateProgress(db, job.id, imported);
            await commitOpenTx();
            const pct = ((imported / job.total_records) * 100).toFixed(1);
            log.info(
              `[CSV Import #${job.id}] Progress: ${imported}/${job.total_records} (${pct}%)`,
            );
            onProgress?.(imported, job.total_records);
          }
        }

        if (!state.cancel && !state.pause && pending.length > 0) {
          if (!inTx) {
            await db.query('BEGIN');
            inTx = true;
          }
          await flushPendingBatch();
        }

        await commitOpenTx();

        if (!state.cancel && !state.pause) {
          await markDone(db, job.id, imported);
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          log.info(`[CSV Import #${job.id}] Completed: ${imported} records in ${elapsed}s`);
          onProgress?.(imported, job.total_records);
        }
      });
    });
  } catch (err) {
    if (inTx) {
      try {
        await db.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error(`[CSV Import #${job.id}] Failed at ${imported}/${job.total_records}: ${errMsg}`);
    await markFailed(db, job.id, imported);
    throw err;
  } finally {
    activeImports.delete(job.id);
  }

  return (await getCsvImportJob(db, job.id))!;
};
