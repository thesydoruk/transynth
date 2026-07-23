export type CsvImportJob = {
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
  running: boolean;
};

export type CsvProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type CsvDoneEvent = { type: 'done'; job: CsvImportJob };
export type CsvErrorEvent = { type: 'error'; error: string };

export type CsvPreviewRow = {
  signature: string;
  formId: string;
  edid: string;
  field: string;
  source: string;
  target: string;
  status: number;
};

export type CsvPreviewResult = {
  rows: CsvPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
};
