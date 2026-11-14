export type PendingModUpload = {
  id: string;
  fileName: string;
  phase: 'uploading' | 'extracting';
  percent: number;
};
