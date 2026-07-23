import type { CsvImportJob, EetImportJob, ModImportJob } from '../../api';

export type UnifiedJob =
  | { kind: 'eet'; job: EetImportJob }
  | { kind: 'csv'; job: CsvImportJob }
  | { kind: 'mod'; job: ModImportJob };

export type PendingModUpload = {
  id: string;
  fileName: string;
  phase: 'uploading' | 'extracting';
  percent: number;
};
