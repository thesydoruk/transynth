import { BASE, downloadBinary, req } from '../client';
import { getSrcLang, getTgtLang } from '../../langDefaults';
import type { ExportArchive } from '../types/exports';

export const exportsEndpoints = {
  startLangpack: (modIds: number[], srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    req<{ ok: true; archive: ExportArchive; jobId: number }>('/api/exports/langpack', {
      method: 'POST',
      body: JSON.stringify({ modIds, srcLang, targetLang }),
    }),
  list: (game?: string) => {
    const params = new URLSearchParams();
    if (game) params.set('game', game);
    const qs = params.toString();
    return req<{ archives: ExportArchive[] }>(`/api/exports${qs ? `?${qs}` : ''}`);
  },
  download: (id: number, fallbackName: string) =>
    downloadBinary(`/api/exports/${id}/file`, fallbackName),
  remove: (id: number) => req<{ ok: true }>(`/api/exports/${id}`, { method: 'DELETE' }),
};

export const exportArchiveDownloadUrl = (id: number): string => `${BASE}/api/exports/${id}/file`;
