// Thin API client — all calls go through the same base URL
const BASE = import.meta.env.VITE_API_URL ?? '';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
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
  status: 'human' | 'fuzzy' | 'auto' | 'tm' | null;
  confidence: number | null;
  provenance: string | null;
  model: string | null;
  updated_at: string | null;
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
  tm: number;
  fuzzy: number;
  auto_translated: number;
  untranslated: number;
  percent: number;
};

export type Signature = { signature: string; count: number };

export type GlossaryEntry = { id: number; term: string; lang: string; count: number; source: string };

export type TMApplyResult = { applied: number; skipped: number; byMethod: Record<string, number> };

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

export type ProgressEvent = { type: 'progress'; done: number; total: number; result: { stringId: number; text?: string; error?: string } };
export type DoneEvent = { type: 'done'; results: Array<{ stringId: number; text?: string; error?: string }> };

// ── Mods ──────────────────────────────────────────────────────────────────────

export const api = {
  mods: {
    list: () => req<Mod[]>('/api/mods'),
    get: (id: number) => req<Mod & { stats: Stats }>(`/api/mods/${id}`),
    tmApply: (modId: number, targetLang = 'uk') =>
      req<TMApplyResult>(`/api/mods/${modId}/tm-apply?targetLang=${targetLang}`, { method: 'POST' }),
    diff: (newModId: number, compareModId: number, targetLang = 'uk') =>
      req<DiffResult>(`/api/mods/${newModId}/diff?compareModId=${compareModId}&targetLang=${targetLang}`),
  },

  stats: {
    mod: (modId: number) => req<Stats>(`/api/stats?modId=${modId}`),
    global: () => req<Array<Mod & { stats: Stats }>>('/api/stats/global'),
  },

  strings: {
    list: (params: {
      modId: number;
      status?: string;
      signature?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    }) => {
      const qs = new URLSearchParams();
      qs.set('modId', String(params.modId));
      if (params.status) qs.set('status', params.status);
      if (params.signature) qs.set('signature', params.signature);
      if (params.q) qs.set('q', params.q);
      if (params.page) qs.set('page', String(params.page));
      if (params.pageSize) qs.set('pageSize', String(params.pageSize));
      return req<StringsResult>(`/api/strings?${qs}`);
    },
    signatures: (modId: number) => req<Signature[]>(`/api/strings/signatures?modId=${modId}`),
    saveTranslation: (stringId: number, text: string, status: 'human' | 'fuzzy' = 'human') =>
      req<{ id: number; text: string; status: string }>(`/api/strings/${stringId}/translation`, {
        method: 'PATCH',
        body: JSON.stringify({ text, status }),
      }),
    updateStatus: (stringId: number, translationId: number, status: string) =>
      req<{ ok: boolean }>(`/api/strings/${stringId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ translationId, status }),
      }),

    /** SSE-streaming batch translate. Calls onProgress for each completed string.
     *  Returns final results array after stream closes. */
    async batchTranslate(
      stringIds: number[],
      targetLang = 'uk',
      onProgress?: (e: ProgressEvent) => void,
    ): Promise<Array<{ stringId: number; text?: string; error?: string }>> {
      const response = await fetch(`${BASE}/api/strings/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stringIds, targetLang }),
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
    list: (params?: { lang?: string; q?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>);
      return req<GlossaryEntry[]>(`/api/glossary?${qs}`);
    },
    add: (term: string, lang: string) =>
      req<GlossaryEntry>('/api/glossary', {
        method: 'POST',
        body: JSON.stringify({ term, lang }),
      }),
    remove: (id: number) => req<{ ok: boolean }>(`/api/glossary/${id}`, { method: 'DELETE' }),
  },
};
