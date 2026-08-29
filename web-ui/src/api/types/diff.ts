export type DiffEntry = {
  formid_hex: string;
  path: string;
  signature: string;
  edid: string | null;
  source: string;
  translation: string | null;
  status: string | null;
  changeType: 'added' | 'removed' | 'changed' | 'unchanged';
};

export type DiffResult = {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  unchanged: number;
};

/** Result of carrying over translations from an old mod version to a new one */
export type CarryOverResult = {
  carried: number;
  needsReview: number;
  skipped: number;
};

/** Result of applying imported mod strings as translations on another mod. */
export type ApplyImportedResult = {
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
};

export type ApplyImportedStats = ApplyImportedResult;

export type ApplyImportedJobSnapshot = {
  jobId: number;
  targetModId: number;
  fromModId: number;
  importedLang: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  stats: ApplyImportedStats;
  error: string | null;
};

export type ApplyImportedStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'done'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'cancelled'; done: number; total: number; stats: ApplyImportedStats }
  | { type: 'error'; error: string };

/** Result of deleting all imported rows for a mod while keeping the mod entry. */
export type ClearModRowsResult = {
  ok: boolean;
  deletedRecords: number;
};

export type DeleteModsBatchResult = ClearModRowsResult & {
  deletedMods: number;
};

/**
 * One row from GET /api/mods/:id/previous-versions.
 * Represents an older version of the same mod (same name, different file hash).
 */
export type PreviousVersionRow = {
  id: number;
  name: string;
  version_hash: string;
  created_at: string;
  total_strings: number;
  translated_strings: number;
};

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};
