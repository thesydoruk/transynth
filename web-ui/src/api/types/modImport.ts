export type ModImportJob = {
  id: number;
  file_name: string;
  file_hash: string;
  mod_id: number | null;
  total_records: number;
  imported_records: number;
  status: string;
  src_lang: string;
  tgt_lang: string;
  is_localized: number;
  game: 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle' | 'disco';
  esp_path: string | null;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type ModImportDeleteDataMode = 'job' | 'rows' | 'mod';

export type ModImportLocaleInfo = {
  jobId: number;
  modId: number | null;
  currentSrcLang: string;
  storedLangs: string[];
  availableLocales: string[];
  isLocalized: boolean;
  stringCount: number;
};

export type ChangeModImportLocaleResult = {
  modId: number;
  jobId: number;
  oldLang: string;
  newLang: string;
  stringsUpdated: number;
  translationsUpdated: number;
};

export type ModProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };
export type UploadProgressEvent = { loaded: number; total: number; percent: number };

export type ProgressEvent = {
  type: 'progress';
  done: number;
  total: number;
  result: { stringId: number; text?: string; error?: string };
};
export type DoneEvent = {
  type: 'done';
  results: Array<{ stringId: number; text?: string; error?: string }>;
};
