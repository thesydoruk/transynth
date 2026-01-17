// Thin API client — all calls go through the same base URL
const BASE = import.meta.env.VITE_API_URL ?? '';

const req = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

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

export type TMApplyResult = { applied: number; skipped: number; byMethod: Record<string, number> };

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
    bulkReview: (modId: number, stringIds: number[], status: 'reviewed' | 'rejected', targetLang = 'uk') =>
      req<{ updated: number }>(`/api/mods/${modId}/bulk-review`, {
        method: 'PATCH',
        body: JSON.stringify({ stringIds, status, targetLang }),
      }),
  },

  stats: {
    mod: (modId: number) => req<Stats>(`/api/stats?modId=${modId}`),
    global: () => req<Array<Mod & { stats: Stats }>>('/api/stats/global'),
  },

  strings: {
    list: (params: {
      modId: number;
      srcLang?: string;
      targetLang?: string;
      status?: string;
      signature?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const qs = new URLSearchParams();
      qs.set('modId', String(params.modId));
      if (params.srcLang) qs.set('srcLang', params.srcLang);
      if (params.targetLang) qs.set('targetLang', params.targetLang);
      if (params.status) qs.set('status', params.status);
      if (params.signature) qs.set('signature', params.signature);
      if (params.q) qs.set('q', params.q);
      if (params.page) qs.set('page', String(params.page));
      if (params.pageSize) qs.set('pageSize', String(params.pageSize));
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
      const res = await fetch(`${BASE}/api/eet/upload`, { method: 'POST', body: form });
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
        const res = await fetch(`${BASE}/api/eet/${jobId}/import`, { signal: ctrl.signal });
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
      const res = await fetch(`${BASE}/api/csv/upload`, { method: 'POST', body: form });
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
        const res = await fetch(`${BASE}/api/csv/${jobId}/import`, { signal: ctrl.signal });
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
      const res = await fetch(`${BASE}/api/mod-import/upload`, { method: 'POST', body: form });
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
        const res = await fetch(`${BASE}/api/mod-import/${jobId}/import`, { signal: ctrl.signal });
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
};
