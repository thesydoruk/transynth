import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type {
  DoneEvent,
  ProgressEvent,
  QAIssue,
  RagSuggestion,
  Signature,
  StringFilterParams,
  StringsResult,
  TranslationHistoryEntry,
} from '../types';

export const stringsEndpoints = {
  list: (params: {
    modId: number;
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
    if (params.qaOnly) qs.set('qaOnly', '1');
    if (params.signature) qs.set('signature', params.signature);
    if (params.q) qs.set('q', params.q);
    if (params.grup) qs.set('grup', params.grup);
    if (params.formid) qs.set('formid', params.formid);
    if (params.edid) qs.set('edid', params.edid);
    if (params.field) qs.set('field', params.field);
    if (params.src) qs.set('src', params.src);
    if (params.transl) qs.set('transl', params.transl);
    if (params.hideIgnored) qs.set('hideIgnored', '1');
    if (params.page) qs.set('page', String(params.page));
    if (params.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params.sort) qs.set('sort', params.sort);
    if (params.order) qs.set('order', params.order);
    return req<StringsResult>(`/api/strings?${qs}`);
  },
  /** Resolve every string ID matching a filter ("select all matching"). */
  matchingIds: (params: { modId: number } & StringFilterParams) => {
    const qs = new URLSearchParams();
    qs.set('modId', String(params.modId));
    if (params.srcLang) qs.set('srcLang', params.srcLang);
    if (params.targetLang) qs.set('targetLang', params.targetLang);
    if (params.status) qs.set('status', params.status);
    if (params.qaOnly) qs.set('qaOnly', '1');
    if (params.signature) qs.set('signature', params.signature);
    if (params.q) qs.set('q', params.q);
    if (params.grup) qs.set('grup', params.grup);
    if (params.formid) qs.set('formid', params.formid);
    if (params.edid) qs.set('edid', params.edid);
    if (params.field) qs.set('field', params.field);
    if (params.src) qs.set('src', params.src);
    if (params.transl) qs.set('transl', params.transl);
    if (params.hideIgnored) qs.set('hideIgnored', '1');
    return req<{ ids: number[] }>(`/api/strings/ids?${qs}`);
  },
  signatures: (modId: number, filters: StringFilterParams = {}) => {
    const qs = new URLSearchParams({ modId: String(modId) });
    if (filters.srcLang) qs.set('srcLang', filters.srcLang);
    if (filters.targetLang) qs.set('targetLang', filters.targetLang);
    if (filters.status) qs.set('status', filters.status);
    if (filters.qaOnly) qs.set('qaOnly', '1');
    if (filters.q) qs.set('q', filters.q);
    if (filters.grup) qs.set('grup', filters.grup);
    if (filters.formid) qs.set('formid', filters.formid);
    if (filters.edid) qs.set('edid', filters.edid);
    if (filters.field) qs.set('field', filters.field);
    if (filters.src) qs.set('src', filters.src);
    if (filters.transl) qs.set('transl', filters.transl);
    if (filters.hideIgnored) qs.set('hideIgnored', '1');
    return req<Signature[]>(`/api/strings/signatures?${qs}`);
  },
  suggestions: (stringId: number, targetLang: string) =>
    req<RagSuggestion[]>(
      `/api/strings/${stringId}/suggestions?targetLang=${encodeURIComponent(targetLang)}`,
    ),
  saveTranslation: (
    stringId: number,
    text: string,
    status:
      | 'draft'
      | 'reviewed'
      | 'rejected'
      | 'human'
      | 'fuzzy'
      | 'auto'
      | 'tm'
      | 'skip' = 'draft',
    targetLang = getTgtLang(),
  ) =>
    req<{ id: number; text: string; status: string }>(`/api/strings/${stringId}/translation`, {
      method: 'PATCH',
      body: JSON.stringify({ text, status, targetLang }),
    }),
  clearTranslation: (stringId: number, targetLang = getTgtLang()) =>
    req<{ removed: number }>(
      `/api/strings/${stringId}/translation?targetLang=${encodeURIComponent(targetLang)}`,
      {
        method: 'DELETE',
      },
    ),
  batchClearTranslations: (
    payload:
      | { stringIds: number[]; targetLang?: string }
      | {
          modId: number;
          filter: StringFilterParams;
          excludeIds?: number[];
          targetLang?: string;
        },
  ) =>
    req<{ removed: number }>(`/api/strings/clear-translations`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  history: (stringId: number, targetLang = getTgtLang()) =>
    req<TranslationHistoryEntry[]>(
      `/api/strings/${stringId}/history?targetLang=${encodeURIComponent(targetLang)}`,
    ),
  qa: (stringId: number, targetLang = getTgtLang()) =>
    req<QAIssue[]>(`/api/strings/${stringId}/qa?targetLang=${encodeURIComponent(targetLang)}`),

  /** Toggle the is_ignored flag on a source string. */
  setIgnored: (stringId: number, ignore: boolean) =>
    req<{ id: number; is_ignored: boolean }>(`/api/strings/${stringId}/ignore`, {
      method: 'PATCH',
      body: JSON.stringify({ ignore }),
    }),

  markSkip: (stringIds: number[], skip = true) =>
    req<{ ok: boolean; marked: number }>(`/api/strings/mark-skip`, {
      method: 'POST',
      body: JSON.stringify({ stringIds, skip }),
    }),

  setStatus: (
    stringIds: number[],
    status: 'draft' | 'reviewed' | 'rejected' | 'human' | 'fuzzy' | 'auto' | 'tm',
    targetLang = getTgtLang(),
  ) =>
    req<{ ok: boolean; updated: number }>(`/api/strings/set-status`, {
      method: 'POST',
      body: JSON.stringify({ stringIds, status, targetLang }),
    }),

  /** SSE-streaming batch translate. Calls onProgress for each completed string.
   *  Returns final results array after stream closes. */
  async batchTranslate(
    stringIds: number[],
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    onProgress?: (e: ProgressEvent) => void,
    modId?: number,
  ): Promise<Array<{ stringId: number; text?: string; error?: string }>> {
    const response = await fetch(`${BASE}/api/strings/translate`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stringIds, srcLang, targetLang, modId }),
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

  /** Apply translation memory to selected untranslated string IDs. */
  batchApplyTm: (
    stringIds: number[],
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    modId?: number,
  ) =>
    req<{
      ok: boolean;
      applied: number;
      skipped: number;
      byMethod: Record<string, number>;
    }>(`/api/strings/tm-apply`, {
      method: 'POST',
      body: JSON.stringify({ stringIds, srcLang, targetLang, modId }),
    }),
};
