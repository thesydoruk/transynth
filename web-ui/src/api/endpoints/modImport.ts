import { BASE, req } from '../client';
import type {
  ModImportDeleteDataMode,
  ModImportJob,
  ModProgressEvent,
  UploadProgressEvent,
} from '../types';

export const modImportEndpoints = {
  list: () => req<ModImportJob[]>('/api/mod-import'),

  upload: async (
    file: File,
    options?: {
      game?: 'fo4' | 'fo76' | 'fo3' | 'fnv' | 'ob' | 'mw' | 'sse' | 'sle';
      srcLang?: string;
      tgtLang?: string;
    },
    onUploadProgress?: (event: UploadProgressEvent) => void,
    onExtractingStart?: () => void,
  ): Promise<ModImportJob> => {
    const qs = new URLSearchParams();
    if (options?.game) qs.set('game', options.game);
    if (options?.srcLang) qs.set('srcLang', options.srcLang);
    if (options?.tgtLang) qs.set('tgtLang', options.tgtLang);
    const form = new FormData();
    form.append('file', file);
    const url = `${BASE}/api/mod-import/upload${qs.toString() ? '?' + qs : ''}`;
    return await new Promise<ModImportJob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (e) => {
        if (!onUploadProgress || !e.lengthComputable) return;
        const total = e.total || file.size || 1;
        const percent = Math.max(0, Math.min(100, Math.round((e.loaded / total) * 100)));
        onUploadProgress({ loaded: e.loaded, total, percent });
      };

      xhr.upload.onload = () => {
        onExtractingStart?.();
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));

      xhr.onload = () => {
        let body: unknown = {};
        try {
          body = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : {};
        } catch {
          body = {};
        }

        if (xhr.status < 200 || xhr.status >= 300) {
          const message = (body as { error?: string }).error ?? `HTTP ${xhr.status}`;
          reject(new Error(message));
          return;
        }

        resolve(body as ModImportJob);
      };

      xhr.send(form);
    });
  },

  startImport(
    jobId: number,
    onProgress?: (e: ModProgressEvent) => void,
  ): { promise: Promise<ModImportJob>; abort: AbortController } {
    const ctrl = new AbortController();

    const promise = (async () => {
      const res = await fetch(`${BASE}/api/mod-import/${jobId}/import`, {
        signal: ctrl.signal,
        credentials: 'include',
      });
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

  pause: (jobId: number) =>
    req<{ ok: boolean }>(`/api/mod-import/${jobId}/pause`, { method: 'POST' }),
  cancel: (jobId: number) =>
    req<{ ok: boolean }>(`/api/mod-import/${jobId}/cancel`, { method: 'POST' }),
  remove: (jobId: number, deleteData: ModImportDeleteDataMode = 'mod') =>
    req<{ ok: boolean }>(`/api/mod-import/${jobId}?deleteData=${deleteData}`, {
      method: 'DELETE',
    }),
  restart: (jobId: number) =>
    req<ModImportJob>(`/api/mod-import/${jobId}/restart`, { method: 'POST' }),

  updateLanguages: (jobId: number, srcLang: string, tgtLang: string) =>
    req<ModImportJob>(`/api/mod-import/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify({ srcLang, tgtLang }),
    }),
};
