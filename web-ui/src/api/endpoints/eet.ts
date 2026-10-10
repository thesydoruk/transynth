import { BASE, req } from '../client';
import { uploadQuery, type ImportFileUploadOptions } from './importFileUpload';
import type { EetImportJob, EetPreviewResult, EetProgressEvent } from '../types';

/** The server refused an EET upload because its header names another game. */
export class EetGameMismatchError extends Error {
  /** The game name the file's header gives, e.g. `Skyrim`. */
  readonly fileGame: string;

  constructor(message: string, fileGame: string) {
    super(message);
    this.name = 'EetGameMismatchError';
    this.fileGame = fileGame;
  }
}

export const eetEndpoints = {
  list: () => req<EetImportJob[]>('/api/eet'),

  upload: async (file: File, options?: ImportFileUploadOptions): Promise<EetImportJob> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${BASE}/api/eet/upload${uploadQuery(options)}`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        fileGame?: string;
      };
      const message = body.error ?? `HTTP ${res.status}`;
      if (body.code === 'eet-game-mismatch' && body.fileGame) {
        throw new EetGameMismatchError(message, body.fileGame);
      }
      throw new Error(message);
    }
    return res.json() as Promise<EetImportJob>;
  },

  startImport(
    jobId: number,
    onProgress?: (e: EetProgressEvent) => void,
  ): { promise: Promise<EetImportJob>; abort: AbortController } {
    const ctrl = new AbortController();

    const promise = (async () => {
      const res = await fetch(`${BASE}/api/eet/${jobId}/import`, {
        signal: ctrl.signal,
        credentials: 'include',
      });
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

  preview: (
    jobId: number,
    params?: { page?: number; pageSize?: number; signature?: string; q?: string },
  ) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.pageSize) qs.set('pageSize', String(params.pageSize));
    if (params?.signature) qs.set('signature', params.signature);
    if (params?.q) qs.set('q', params.q);
    return req<EetPreviewResult>(`/api/eet/${jobId}/preview?${qs}`);
  },
};
