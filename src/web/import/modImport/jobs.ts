import type { Tx } from '../../../db';
import type { ModImportJob } from './types';

/** API/job row shape — excludes `archive_manifest` (lives on disk as import-manifest.json). */
const MOD_IMPORT_JOB_LIST_SQL = `SELECT
  id, file_name, file_hash, mod_id, total_records, imported_records, status,
  src_lang, tgt_lang, is_localized, game, esp_path, extract_dir,
  nexus_mod_id, source_folder, nexus_mod_name, created_at, updated_at
 FROM mod_imports`;

/**
 * List all mod import jobs ordered by newest first.
 */
export const listModImportJobs = async (db: Tx): Promise<ModImportJob[]> => {
  const { rows } = await db.query(`${MOD_IMPORT_JOB_LIST_SQL} ORDER BY created_at DESC`);
  return rows.map((row) => ({ ...row, archive_manifest: null })) as ModImportJob[];
};

/**
 * Fetch a single import job by id.
 */
export const getModImportJob = async (db: Tx, id: number): Promise<ModImportJob | undefined> => {
  const { rows } = await db.query(`${MOD_IMPORT_JOB_LIST_SQL} WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return undefined;
  return { ...row, archive_manifest: null } as ModImportJob;
};

export const getModImportJobByFileHash = async (
  db: Tx,
  fileHash: string,
): Promise<ModImportJob | undefined> => {
  const { rows } = await db.query(`${MOD_IMPORT_JOB_LIST_SQL} WHERE file_hash = $1`, [fileHash]);
  const row = rows[0];
  if (!row) return undefined;
  return { ...row, archive_manifest: null } as ModImportJob;
};

export const updateModJobLanguages = async (
  db: Tx,
  id: number,
  srcLang: string,
  tgtLang: string,
) => {
  await db.query(
    `UPDATE mod_imports
     SET src_lang = $1,
         tgt_lang = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [srcLang, tgtLang, id],
  );
};

/**
 * Resets a finished/failed/paused mod import job back to pending so it can be
 * started again from the beginning.
 */
export const restartModImportJob = async (db: Tx, id: number) => {
  await db.query(
    `UPDATE mod_imports
     SET status = 'pending', imported_records = 0, updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
};

/**
 * Delete an import job row.
 *
 * Note: this does not delete any ingested strings/records for the associated
 * mod; it only removes the job tracker.
 */
export const deleteModImportJob = async (db: Tx, id: number) => {
  await db.query('DELETE FROM mod_imports WHERE id = $1', [id]);
};

export const deriveModNameFromFileName = (fileName: string): string => {
  return fileName.replace(/\.(esp|esm|esl|zip|7z|rar)$/i, '');
};
