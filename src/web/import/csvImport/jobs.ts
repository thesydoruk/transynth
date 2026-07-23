import type { Tx } from '../../../db';
import type { CsvImportJob } from './types';

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

export const getOrCreateJob = async (
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

export const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE csv_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};
