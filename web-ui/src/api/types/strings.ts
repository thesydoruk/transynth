export type StringRow = {
  string_id: number;
  formid_hex: string;
  signature: string;
  path: string;
  edid: string | null;
  source: string;
  /** Speaker NPC name for dialog strings (INFO records). Populated at import time from ANAM. */
  context: string | null;
  is_ignored?: boolean;
  translation_id: number | null;
  translation: string | null;
  status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | 'skip' | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
  /** Resolved speaker/narrator gender for this line. */
  line_gender?: 'male' | 'female' | 'any' | 'unknown' | 'neutral' | null;
};

export type StringsResult = {
  rows: StringRow[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Filter criteria shared by the string-grid list query and the "matching IDs"
 * lookup. Mirrors the server-side `StringsFilter` minus pagination/sort fields.
 */
export type StringFilterParams = {
  srcLang?: string;
  targetLang?: string;
  status?: string;
  qaOnly?: boolean;
  signature?: string;
  q?: string;
  grup?: string;
  formid?: string;
  edid?: string;
  field?: string;
  src?: string;
  transl?: string;
  hideIgnored?: boolean;
};

export type TranslationHistoryEntry = {
  id: number;
  translation_id: number | null;
  text: string | null;
  status: string;
  provenance: string | null;
  model: string | null;
  note: string | null;
  created_at: string;
};

export type QAIssue = {
  id: number;
  issue_type: string;
  severity: 'warning' | 'error';
  message: string;
  updated_at: string;
};

export type Signature = { signature: string; count: number };
