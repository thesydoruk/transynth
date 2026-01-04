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

// ── Mods ──────────────────────────────────────────────────────────────────────

export const api = {
  mods: {
    list: () => req<Mod[]>('/api/mods'),
    get: (id: number) => req<Mod & { stats: Stats }>(`/api/mods/${id}`),
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
    batchTranslate: (stringIds: number[], targetLang = 'uk') =>
      req<{ results: Array<{ stringId: number; text?: string; error?: string }> }>(
        '/api/strings/translate',
        { method: 'POST', body: JSON.stringify({ stringIds, targetLang }) },
      ),
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
