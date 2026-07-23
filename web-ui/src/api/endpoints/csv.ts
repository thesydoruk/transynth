import { BASE, req } from '../client';
import type { CsvImportJob, CsvPreviewResult, CsvProgressEvent } from '../types';

export const csvEndpoints = {
  list: () => req<CsvImportJob[]>('/api/csv'),

  upload: async (file: File): Promise<CsvImportJob> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/csv/upload`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
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
      const res = await fetch(`${BASE}/api/csv/${jobId}/import`, {
        signal: ctrl.signal,
        credentials: 'include',
      });
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

  preview: (
    jobId: number,
    params?: { page?: number; pageSize?: number; signature?: string; q?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.signature) qs.set('signature', params.signature);
    if (params?.q) qs.set('q', params.q);
    return req<CsvPreviewResult>(`/api/csv/${jobId}/preview?${qs}`);
  },
};
