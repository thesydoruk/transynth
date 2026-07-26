/**
 * Status transitions for `mod_imports` job rows. The worker's import loop
 * commits these between batches; the API uses `markFailed` on cancel.
 */
import type { Tx } from '../../db';

export const updateProgress = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET imported_records = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markDone = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'completed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markFailed = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'failed', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};

export const markPaused = async (db: Tx, jobId: number, importedRecords: number) => {
  await db.query(
    `UPDATE mod_imports SET status = 'paused', imported_records = $1, updated_at = NOW() WHERE id = $2`,
    [importedRecords, jobId],
  );
};
