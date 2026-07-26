import type { Tx } from '../../db';

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

export const ensureCsvImportSchema = async (_db: Tx) => {
  // Schema is now managed by sql/schema.sql — no-op
};
