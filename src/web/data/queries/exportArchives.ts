import type { Tx } from '../../../db';
import type { GameType } from '../../../types';

export type ExportArchiveStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type ExportArchiveRow = {
  id: number;
  game: string;
  src_lang: string;
  tgt_lang: string;
  label: string;
  file_name: string;
  rel_path: string | null;
  byte_size: string | null;
  mod_ids: number[];
  job_id: number | null;
  status: ExportArchiveStatus;
  error: string | null;
  done_count: number;
  total_count: number;
  created_at: Date;
  updated_at: Date;
};

export const insertExportArchive = async (
  db: Tx,
  row: {
    game: GameType | string;
    srcLang: string;
    tgtLang: string;
    label: string;
    fileName: string;
    modIds: number[];
    totalCount: number;
  },
): Promise<ExportArchiveRow> => {
  const { rows } = await db.query<ExportArchiveRow>(
    `INSERT INTO export_archives
       (game, src_lang, tgt_lang, label, file_name, mod_ids, total_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [row.game, row.srcLang, row.tgtLang, row.label, row.fileName, row.modIds, row.totalCount],
  );
  return rows[0]!;
};

export const listExportArchives = async (
  db: Tx,
  game?: string,
  limit = 50,
): Promise<ExportArchiveRow[]> => {
  const { rows } = game
    ? await db.query<ExportArchiveRow>(
        `SELECT * FROM export_archives WHERE game = $1 ORDER BY created_at DESC LIMIT $2`,
        [game, limit],
      )
    : await db.query<ExportArchiveRow>(
        `SELECT * FROM export_archives ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
  return rows;
};

export const getExportArchive = async (db: Tx, id: number): Promise<ExportArchiveRow | null> => {
  const { rows } = await db.query<ExportArchiveRow>(`SELECT * FROM export_archives WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
};

export const findRunningExportArchive = async (db: Tx): Promise<ExportArchiveRow | null> => {
  const { rows } = await db.query<ExportArchiveRow>(
    `SELECT * FROM export_archives WHERE status = 'running' ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
};

export const setExportArchiveJobId = async (
  db: Tx,
  id: number,
  jobId: number,
): Promise<void> => {
  await db.query(`UPDATE export_archives SET job_id = $2, updated_at = NOW() WHERE id = $1`, [
    id,
    jobId,
  ]);
};

export const setExportArchiveProgress = async (
  db: Tx,
  id: number,
  doneCount: number,
  totalCount: number,
): Promise<void> => {
  await db.query(
    `UPDATE export_archives SET done_count = $2, total_count = $3, updated_at = NOW() WHERE id = $1`,
    [id, doneCount, totalCount],
  );
};

export const finalizeExportArchive = async (
  db: Tx,
  id: number,
  patch: {
    status: ExportArchiveStatus;
    error?: string | null;
    relPath?: string | null;
    byteSize?: number | null;
  },
): Promise<void> => {
  await db.query(
    `UPDATE export_archives SET
        status = $2,
        error = $3,
        rel_path = COALESCE($4, rel_path),
        byte_size = COALESCE($5, byte_size),
        updated_at = NOW()
     WHERE id = $1`,
    [id, patch.status, patch.error ?? null, patch.relPath ?? null, patch.byteSize ?? null],
  );
};

export const deleteExportArchiveRow = async (db: Tx, id: number): Promise<boolean> => {
  const { rowCount } = await db.query(`DELETE FROM export_archives WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
};
