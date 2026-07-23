export type EetImportJob = {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  /** Error message stored when status transitions to 'failed'. Null otherwise. */
  last_error: string | null;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type EetProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type EetDoneEvent = { type: 'done'; job: EetImportJob };
export type EetErrorEvent = { type: 'error'; error: string };

export type EetPreviewRow = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
};

export type EetPreviewResult = {
  rows: EetPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
};
