// Thin API client — all calls go through the same base URL
const BASE = import.meta.env.VITE_API_URL ?? '';

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  /* Only set Content-Type: application/json when the request carries a body.
     Fastify 5 rejects requests with Content-Type: application/json but no body
     (FST_ERR_CTP_EMPTY_JSON_BODY), which breaks DELETE / POST calls without a payload. */
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (init?.body) {
    headers['Content-Type'] ??= 'application/json';
  }
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetches a binary file from the API and triggers a browser download.
 * Used for endpoints that return raw binary content (e.g. ZIP archives)
 * instead of JSON.
 *
 * @param path - API endpoint path
 * @param fallbackName - Filename to use if the server doesn't provide one
 */
const downloadBinary = async (path: string, fallbackName: string): Promise<void> => {
  const res = await fetch(`${BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  // Extract filename from Content-Disposition header if available
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="([^"]+)"/);
  const fileName = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Authenticated user profile. */
export type User = {
  id: number;
  username: string;
  display_name: string;
  role: 'admin' | 'translator' | 'reviewer';
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** A single activity log entry returned by /api/activity. */
export type ActivityEntry = {
  id: number;
  user_id: number | null;
  username: string | null;
  display_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Paginated response from /api/activity. */
export type ActivityLogResponse = {
  entries: ActivityEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type Mod = {
  id: number;
  name: string;
  abs_path: string;
  version_hash: string;
  created_at: string;
  record_count: number;
  string_count: number;
  translated_count: number;
  approved_count: number;
  fuzzy_count: number;
};

export type StringRow = {
  string_id: number;
  formid_hex: string;
  signature: string;
  path: string;
  edid: string | null;
  source: string;
  translation_id: number | null;
  translation: string | null;
  status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
  qa_issue_count: number;
};

export type StringsResult = {
  rows: StringRow[];
  total: number;
  page: number;
  pageSize: number;
};

export type Stats = {
  total: number;
  translated: number;
  approved: number;
  draft: number;
  rejected: number;
  tm: number;
  fuzzy: number;
  auto_translated: number;
  untranslated: number;
  percent: number;
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

export type GlossaryEntry = { id: number; term: string; translation: string | null; src_lang: string; tgt_lang: string; source: string; created_at: string };

/** A configurable QA validation rule (forbidden characters or max length per GRUP/field). */
export type QARule = {
  id: number;
  game: string;
  rule_type: 'forbidden_chars' | 'max_length';
  signature: string | null;
  path: string | null;
  value: string;
  severity: 'warning' | 'error';
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type TMApplyResult = { applied: number; skipped: number; byMethod: Record<string, number> };

/**
 * A single string entry within a coherence group — one source string whose
 * current translation differs from at least one other string in the same group.
 */
export type CoherenceEntry = {
  string_id: number;
  source_text: string;
  text_norm: string;
  edid: string | null;
  signature: string;
  path_simplified: string;
  mod_id: number;
  mod_name: string;
  translation_id: number | null;
  /** The current best translation for this string. */
  translation: string;
  status: string;
};

/**
 * A coherence group — all source strings sharing the same normalised text
 * that are currently translated inconsistently.
 */
export type CoherenceGroup = {
  text_norm: string;
  /** Representative raw source text for display. */
  source_text: string;
  /** Number of distinct translation variants in this group. */
  variant_count: number;
  entries: CoherenceEntry[];
};

/** Paginated coherence report returned by GET /api/coherence. */
export type CoherenceResult = {
  groups: CoherenceGroup[];
  /** Total number of inconsistency groups (before pagination). */
  total: number;
};

export type DashboardModRow = {
  id: number;
  name: string;
  total: number;
  translated: number;
  approved: number;
  draft: number;
  tm: number;
  fuzzy: number;
  auto: number;
  rejected: number;
  reviewed: number;
  qa_issues: number;
};

export type DashboardData = {
  mods: DashboardModRow[];
  qaByType: { issue_type: string; count: number }[];
  qaBySeverity: { severity: string; count: number }[];
};

export type ExportedStringsFile = {
  fileName: string;
  size: number;
  contentBase64: string;
};

export type ExportStringsResult = {
  modId: number;
  srcLang: string;
  targetLang: string;
  files: ExportedStringsFile[];
};

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

/** Result of importing a TMX file into the translation memory */
export type TmxImportResult = {
  parsed: number;
  imported: number;
  skipped: number;
};

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};

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
  esp_path: string | null;
  created_at: string;
  updated_at: string;
  running: boolean;
};

export type ModProgressEvent = { type: 'progress'; imported: number; total: number; jobId: number };

export type ModPreviewRow = {
  formId: string;
  signature: string;
  edid: string;
  path: string;
  source: string;
};

export type ModPreviewResult = {
  rows: ModPreviewRow[];
  total: number;
  page: number;
  pageSize: number;
  signatures: string[];
  locales: string[];
  isLocalized: boolean;
};

export type ProgressEvent = { type: 'progress'; done: number; total: number; result: { stringId: number; text?: string; error?: string } };
export type DoneEvent = { type: 'done'; results: Array<{ stringId: number; text?: string; error?: string }> };

// ── Mods ──────────────────────────────────────────────────────────────────────

export type TMSuggestion = {
  id: number;
  text: string;
  status: string;
  confidence: number | null;
  provenance: string | null;
  source_text: string;
  match_method: 'exact' | 'punct_norm' | 'fuzzy' | 'segment';
  similarity: number;
};

export const api = {
  mods: {
    list: () => req<Mod[]>('/api/mods'),
    get: (id: number) => req<Mod & { stats: Stats }>(`/api/mods/${id}`),
    langs: (id: number) => req<string[]>(`/api/mods/${id}/langs`),
    tmApply: (modId: number, srcLang = 'en', targetLang = 'uk') =>
      req<TMApplyResult>(`/api/mods/${modId}/tm-apply?srcLang=${srcLang}&targetLang=${targetLang}`, { method: 'POST' }),
    diff: (newModId: number, compareModId: number, targetLang = 'uk') =>
      req<DiffResult>(`/api/mods/${newModId}/diff?compareModId=${compareModId}&targetLang=${targetLang}`),
    exportStrings: (modId: number, srcLang = 'en', targetLang = 'uk') =>
      req<ExportStringsResult>(`/api/mods/${modId}/export/strings?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`),
    exportEsp: (modId: number, srcLang = 'en', targetLang = 'uk') =>
      req<ExportStringsResult>(`/api/mods/${modId}/export/esp?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`),
    exportBa2: (modId: number, srcLang = 'en', targetLang = 'uk') =>
      req<ExportStringsResult>(`/api/mods/${modId}/export/ba2?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`),
    /** Downloads a complete project ZIP (BA2 + patched ESP) as a single file */
    exportProject: (modId: number, srcLang = 'en', targetLang = 'uk') =>
      downloadBinary(
        `/api/mods/${modId}/export/project?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
        `mod_${modId}_${targetLang}.zip`,
      ),
    /** Copy translations from an older mod version into a newer one */
    carryOver: (newModId: number, fromModId: number, targetLang = 'uk') =>
      req<CarryOverResult>(`/api/mods/${newModId}/carry-over?fromModId=${fromModId}&targetLang=${encodeURIComponent(targetLang)}`, { method: 'POST' }),
    bulkReview: (modId: number, stringIds: number[], status: 'reviewed' | 'rejected', targetLang = 'uk') =>
      req<{ updated: number }>(`/api/mods/${modId}/bulk-review`, {
        method: 'PATCH',
        body: JSON.stringify({ stringIds, status, targetLang }),
      }),
  },

  stats: {
    mod: (modId: number) => req<Stats>(`/api/stats?modId=${modId}`),
    global: () => req<Array<Mod & { stats: Stats }>>('/api/stats/global'),
    dashboard: () => req<DashboardData>('/api/stats/dashboard'),
  },

  strings: {
    list: (params: {
      modId: number;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      signature?: string;
      q?: string;
      grup?: string;
      formid?: string;
      edid?: string;
      field?: string;
      src?: string;
      transl?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
      order?: 'asc' | 'desc';
    }) => {
      const qs = new URLSearchParams();
      qs.set('modId', String(params.modId));
      if (params.srcLang) qs.set('srcLang', params.srcLang);
      if (params.targetLang) qs.set('targetLang', params.targetLang);
      if (params.status) qs.set('status', params.status);
      if (params.signature) qs.set('signature', params.signature);
      if (params.q) qs.set('q', params.q);
      if (params.grup) qs.set('grup', params.grup);
      if (params.formid) qs.set('formid', params.formid);
      if (params.edid) qs.set('edid', params.edid);
      if (params.field) qs.set('field', params.field);
      if (params.src) qs.set('src', params.src);
      if (params.transl) qs.set('transl', params.transl);
      if (params.page) qs.set('page', String(params.page));
      if (params.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params.sort) qs.set('sort', params.sort);
      if (params.order) qs.set('order', params.order);
      return req<StringsResult>(`/api/strings?${qs}`);
    },
    signatures: (modId: number, srcLang?: string) => {
      const qs = new URLSearchParams({ modId: String(modId) });
      if (srcLang) qs.set('srcLang', srcLang);
      return req<Signature[]>(`/api/strings/signatures?${qs}`);
    },
    suggestions: (stringId: number, targetLang: string) =>
      req<TMSuggestion[]>(`/api/strings/${stringId}/suggestions?targetLang=${encodeURIComponent(targetLang)}`),
    saveTranslation: (stringId: number, text: string, status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm' = 'draft', targetLang = 'uk') =>
      req<{ id: number; text: string; status: string }>(`/api/strings/${stringId}/translation`, {
        method: 'PATCH',
        body: JSON.stringify({ text, status, targetLang }),
      }),
    clearTranslation: (stringId: number, targetLang = 'uk') =>
      req<{ removed: number }>(`/api/strings/${stringId}/translation?targetLang=${encodeURIComponent(targetLang)}`, {
        method: 'DELETE',
      }),
    updateStatus: (stringId: number, translationId: number, status: string) =>
      req<{ ok: boolean }>(`/api/strings/${stringId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ translationId, status }),
      }),
    history: (stringId: number, targetLang = 'uk') =>
      req<TranslationHistoryEntry[]>(`/api/strings/${stringId}/history?targetLang=${encodeURIComponent(targetLang)}`),
    qa: (stringId: number, targetLang = 'uk') =>
      req<QAIssue[]>(`/api/strings/${stringId}/qa?targetLang=${encodeURIComponent(targetLang)}`),

    /** SSE-streaming batch translate. Calls onProgress for each completed string.
     *  Returns final results array after stream closes. */
    async batchTranslate(
      stringIds: number[],
      srcLang = 'en',
      targetLang = 'uk',
      onProgress?: (e: ProgressEvent) => void,
    ): Promise<Array<{ stringId: number; text?: string; error?: string }>> {
      const response = await fetch(`${BASE}/api/strings/translate`, {
        credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringIds, srcLang, targetLang }),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let results: Array<{ stringId: number; text?: string; error?: string }> = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as ProgressEvent | DoneEvent;
            if (event.type === 'progress' && onProgress) onProgress(event);
            if (event.type === 'done') results = event.results;
          } catch {
            // ignore malformed SSE line
          }
        }
      }
      return results;
    },
  },

  search: {
    replace: (
      modId: number,
      body: { search: string; replace: string; isRegex?: boolean; targetLang?: string; dryRun?: boolean },
    ) =>
      req<{ matches: SearchReplaceMatch[]; applied: number }>(`/api/mods/${modId}/search-replace`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  glossary: {
    list: (params?: { srcLang?: string; tgtLang?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.srcLang) qs.set('srcLang', params.srcLang);
      if (params?.tgtLang) qs.set('tgtLang', params.tgtLang);
      if (params?.q) qs.set('q', params.q);
      return req<GlossaryEntry[]>(`/api/glossary?${qs}`);
    },
    add: (term: string, translation: string | null, srcLang = 'en', tgtLang = 'uk') =>
      req<GlossaryEntry>('/api/glossary', {
        method: 'POST',
        body: JSON.stringify({ term, translation, srcLang, tgtLang }),
      }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/glossary/${id}`, { method: 'DELETE' }),
  },

  eet: {
    list: () => req<EetImportJob[]>('/api/eet'),

    upload: async (file: File): Promise<EetImportJob> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/eet/upload`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<EetImportJob>;
    },

    startImport(
      jobId: number,
      onProgress?: (e: EetProgressEvent) => void,
    ): { promise: Promise<EetImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/eet/${jobId}/import`, { signal: ctrl.signal, credentials: 'include' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: EetImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number) => req<{ ok: boolean }>(`/api/eet/${jobId}`, { method: 'DELETE' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<EetImportJob>(`/api/eet/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (jobId: number, params?: { page?: number; pageSize?: number; signature?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<EetPreviewResult>(`/api/eet/${jobId}/preview?${qs}`);
    },
  },

  csv: {
    list: () => req<CsvImportJob[]>('/api/csv'),

    upload: async (file: File): Promise<CsvImportJob> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/csv/upload`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<CsvImportJob>;
    },

    startImport(
      jobId: number,
      onProgress?: (e: CsvProgressEvent) => void,
    ): { promise: Promise<CsvImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/csv/${jobId}/import`, { signal: ctrl.signal, credentials: 'include' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: CsvImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number) => req<{ ok: boolean }>(`/api/csv/${jobId}`, { method: 'DELETE' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<CsvImportJob>(`/api/csv/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (jobId: number, params?: { page?: number; pageSize?: number; signature?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<CsvPreviewResult>(`/api/csv/${jobId}/preview?${qs}`);
    },
  },

  modImport: {
    list: () => req<ModImportJob[]>('/api/mod-import'),

    upload: async (file: File): Promise<ModImportJob> => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/mod-import/upload`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<ModImportJob>;
    },

    startImport(
      jobId: number,
      onProgress?: (e: ModProgressEvent) => void,
    ): { promise: Promise<ModImportJob>; abort: AbortController } {
      const ctrl = new AbortController();

      const promise = (async () => {
        const res = await fetch(`${BASE}/api/mod-import/${jobId}/import`, { signal: ctrl.signal, credentials: 'include' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let result: ModImportJob | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'progress' && onProgress) onProgress(ev);
              if (ev.type === 'done') result = ev.job;
              if (ev.type === 'error') throw new Error(ev.error);
            } catch (e) {
              if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
            }
          }
        }
        if (!result) throw new Error('Stream ended without done event');
        return result;
      })();

      return { promise, abort: ctrl };
    },

    pause: (jobId: number) => req<{ ok: boolean }>(`/api/mod-import/${jobId}/pause`, { method: 'POST' }),
    cancel: (jobId: number) => req<{ ok: boolean }>(`/api/mod-import/${jobId}/cancel`, { method: 'POST' }),
    remove: (jobId: number) => req<{ ok: boolean }>(`/api/mod-import/${jobId}`, { method: 'DELETE' }),

    updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
      req<ModImportJob>(`/api/mod-import/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ srcLang, tgtLang }),
      }),

    preview: (jobId: number, params?: { page?: number; pageSize?: number; signature?: string; q?: string }) => {
      const qs = new URLSearchParams();
      if (params?.page) qs.set('page', String(params.page));
      if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
      if (params?.signature) qs.set('signature', params.signature);
      if (params?.q) qs.set('q', params.q);
      return req<ModPreviewResult>(`/api/mod-import/${jobId}/preview?${qs}`);
    },
  },

  /** TMX (Translation Memory eXchange) import/export */
  tmx: {
    /** Download TMX export as a file. modId is optional — omit for global export. */
    exportFile: (srcLang = 'en', targetLang = 'uk', modId?: number) => {
      const qs = new URLSearchParams({ srcLang, targetLang });
      if (modId != null) qs.set('modId', String(modId));
      return downloadBinary(`/api/tmx/export?${qs}`, `tm_${targetLang}.tmx`);
    },
    /** Upload a TMX file for import. modId is optional — omit for global match. */
    importFile: async (file: File, modId?: number): Promise<TmxImportResult> => {
      const form = new FormData();
      form.append('file', file);
      const qs = modId != null ? `?modId=${modId}` : '';
      const res = await fetch(`${BASE}/api/tmx/import${qs}`, { method: 'POST', body: form, credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      return res.json() as Promise<TmxImportResult>;
    },
  },

  /** Auth, users, and activity log */
  auth: {
    /** Returns whether multi-user mode is enabled */
    mode: () => req<{ multiUser: boolean }>('/api/auth/mode'),
    /** Returns the current authenticated user (or default admin in single-user mode) */
    me: () => req<User>('/api/auth/me'),
    /** Logs in with username and password. Sets a session cookie on success. */
    login: (username: string, password: string) =>
      req<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    /** Logs out and clears the session cookie. */
    logout: () => req<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  },

  users: {
    /** Lists all users */
    list: () => req<User[]>('/api/users'),
    /** Creates a new user (admin only) */
    create: (data: { username: string; display_name: string; password: string; role: string }) =>
      req<User>('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    /** Updates a user's profile (admin only) */
    update: (id: number, data: { display_name?: string; role?: string; is_active?: boolean }) =>
      req<User>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    /** Changes a user's password */
    changePassword: (id: number, new_password: string) =>
      req<{ ok: boolean }>(`/api/users/${id}/password`, { method: 'POST', body: JSON.stringify({ new_password }) }),
  },

  activity: {
    /** Fetches paginated activity log entries */
    list: (params?: { limit?: number; offset?: number; userId?: number; action?: string }) => {
      const qs = new URLSearchParams();
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.offset) qs.set('offset', String(params.offset));
      if (params?.userId) qs.set('userId', String(params.userId));
      if (params?.action) qs.set('action', params.action);
      return req<ActivityLogResponse>(`/api/activity?${qs}`);
    },
  },

  /** Configurable QA validation rules (forbidden characters, max length per GRUP/field). */
  qaRules: {
    list: (params?: { game?: string; ruleType?: string; isActive?: string }) => {
      const qs = new URLSearchParams();
      if (params?.game) qs.set('game', params.game);
      if (params?.ruleType) qs.set('ruleType', params.ruleType);
      if (params?.isActive) qs.set('isActive', params.isActive);
      return req<QARule[]>(`/api/qa-rules?${qs}`);
    },
    get: (id: number) => req<QARule>(`/api/qa-rules/${id}`),
    create: (data: Omit<QARule, 'id' | 'created_at' | 'updated_at'>) =>
      req<QARule>('/api/qa-rules', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Omit<QARule, 'id' | 'created_at' | 'updated_at'>>) =>
      req<QARule>(`/api/qa-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/qa-rules/${id}`, { method: 'DELETE' }),
  },

  /**
   * Coherence checking — source strings that share the same normalised text
   * but have different translations across strings/mods.
   */
  coherence: {
    /**
     * Returns a paginated coherence report.
     * Groups are ordered by variant_count DESC (most conflicted first).
     */
    list: (params?: { targetLang?: string; limit?: number; offset?: number }) => {
      const qs = new URLSearchParams();
      if (params?.targetLang) qs.set('targetLang', params.targetLang);
      if (params?.limit !== undefined) qs.set('limit', String(params.limit));
      if (params?.offset !== undefined) qs.set('offset', String(params.offset));
      return req<CoherenceResult>(`/api/coherence?${qs}`);
    },
    /**
     * Resolves a coherence group by propagating a single chosen translation
     * to all strings in the group that currently have a different translation.
     */
    resolve: (textNorm: string, translation: string, targetLang = 'uk') =>
      req<{ updated: number }>('/api/coherence/resolve', {
        method: 'POST',
        body: JSON.stringify({ textNorm, translation, targetLang }),
      }),
  },
};
