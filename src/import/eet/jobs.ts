/**
 * `eet_imports` job rows — schema, lookups and status transitions.
 *
 * Jobs are keyed by the file hash so re-uploading the same file resumes the
 * existing job instead of creating a duplicate. The progress/status helpers are
 * exported for the worker's import loop, which commits them between batches.
 */
import type { Tx } from '../../db';

/** Import job row stored in the `eet_imports` table. */
export interface ImportJob {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export type ProgressCb = (imported: number, total: number) => void;

export const ensureImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
};

export const listImportJobs = async (db: Tx): Promise<ImportJob[]> => {
  const { rows } = await db.query('SELECT * FROM eet_imports ORDER BY created_at DESC');
  return rows as ImportJob[];
};

export const getImportJob = async (db: Tx, id: number): Promise<ImportJob | undefined> => {
  const { rows } = await db.query('SELECT * FROM eet_imports WHERE id = $1', [id]);
  return rows[0] as ImportJob | undefined;
};

export const updateJobLanguages = async (db: Tx, id: number, srcLang: string, tgtLang: string) => {
  await db.query(
    `UPDATE eet_imports SET src_lang = $1, tgt_lang = $2, updated_at = NOW() WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
};

export const deleteImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM eet_imports WHERE id = $1', [id]);
};

export const getOrCreateJob = async (
  db: Tx,
  fileName: string,
  fileHash: string,
  modId: number,
  totalRecords: number,
  srcLang: string,
  tgtLang: string,
): Promise<ImportJob> => {
  const { rows: existing } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [
    fileHash,
  ]);
  if (existing[0]) return existing[0] as ImportJob;

  await db.query(
    `INSERT INTO eet_imports(file_name, file_hash, mod_id, total_records, status, src_lang, tgt_lang)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [fileName, fileHash, modId, totalRecords, srcLang, tgtLang],
  );

  const { rows } = await db.query('SELECT * FROM eet_imports WHERE file_hash = $1', [fileHash]);
  return rows[0] as ImportJob;
};

export const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markFailed = async (
  db: Tx,
  jobId: number,
  importedRecords: number,
  errorMsg?: string,
) => {
  await db.query(
    `UPDATE eet_imports SET status = 'failed', imported_records = $1, last_error = $2, updated_at = NOW() WHERE id = $3`,
    [importedRecords, errorMsg ?? null, jobId],
  );
};

export const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE eet_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};
