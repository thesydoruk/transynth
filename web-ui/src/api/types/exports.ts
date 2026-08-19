export type ExportArchiveStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type ExportArchive = {
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
  created_at: string;
  updated_at: string;
};
