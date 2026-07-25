import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, downloadBinary, req } from '../client';
import type {
  ApplyImportedJobSnapshot,
  ApplyImportedResult,
  ApplyImportedStreamEvent,
  CarryOverResult,
  ClearModRowsResult,
  ClearSameAsSourceResult,
  DeleteModsBatchResult,
  DiffResult,
  Mod,
  PexSourceSnippetResponse,
  PreviousVersionRow,
  VoiceAvailabilityResponse,
  VoiceLinesResponse,
  VoiceRegenerateParams,
  VoiceRegeneratePreview,
  VoiceSpeakerRefPick,
} from '../types';

export const modsEndpoints = {
  list: (game?: string, srcLang = getSrcLang(), targetLang = getTgtLang()) => {
    const params = new URLSearchParams({ srcLang, targetLang });
    if (game) params.set('game', game);
    return req<Mod[]>(`/api/mods?${params}`);
  },
  get: (id: number) => req<Mod>(`/api/mods/${id}`),
  pexSource: async (modId: number, stringId: number): Promise<PexSourceSnippetResponse> => {
    const res = await fetch(`${BASE}/api/mods/${modId}/pex-source/${stringId}`, {
      credentials: 'include',
    });
    return (await res.json()) as PexSourceSnippetResponse;
  },
  voiceLines: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) => {
    const params = new URLSearchParams({ srcLang, targetLang });
    return req<VoiceLinesResponse>(`/api/mods/${modId}/voice/lines?${params}`);
  },
  /** Which lines of the mod have audio, without the heavier voice-line metadata. */
  voiceAvailability: (modId: number, targetLang = getTgtLang()) =>
    req<VoiceAvailabilityResponse>(
      `/api/mods/${modId}/voice/availability?targetLang=${encodeURIComponent(targetLang)}`,
    ),
  setVoiceSpeakerRef: (modId: number, speakerKey: string, formidLower6: string, variant: number) =>
    req<{ ok: true; referencePick: VoiceSpeakerRefPick }>(`/api/mods/${modId}/voice/speaker-ref`, {
      method: 'PUT',
      body: JSON.stringify({ speakerKey, formidLower6, variant }),
    }),
  clearVoiceSpeakerRef: (modId: number, speakerKey: string) =>
    req<{ ok: true; referencePick: null }>(
      `/api/mods/${modId}/voice/speaker-ref/${encodeURIComponent(speakerKey)}`,
      { method: 'DELETE' },
    ),
  generateVoiceLine: (
    modId: number,
    formidLower6: string,
    variant: number,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) => {
    const params = new URLSearchParams({ srcLang, targetLang });
    return req<{ ok: true; relPath: string; skipped: boolean }>(
      `/api/mods/${modId}/voice/translation-audio/${formidLower6}/${variant}?${params}`,
      { method: 'POST' },
    );
  },
  initVoiceRegenerateSession: (
    modId: number,
    formidLower6: string,
    variant: number,
    sessionId: string,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) =>
    req<{ ok: true; defaultParams: VoiceRegenerateParams }>(
      `/api/mods/${modId}/voice/regenerate/${formidLower6}/${variant}/session`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, srcLang, targetLang }),
      },
    ),
  getVoiceRegenerateSession: (modId: number, sessionId: string) =>
    req<{
      ok: true;
      formidLower6: string;
      variant: number;
      srcLang: string;
      targetLang: string;
      previews: VoiceRegeneratePreview[];
    }>(`/api/mods/${modId}/voice/regenerate/${sessionId}`),
  generateVoiceRegeneratePreview: (
    modId: number,
    sessionId: string,
    body: {
      formidLower6: string;
      variant: number;
      srcLang: string;
      targetLang: string;
      params: VoiceRegenerateParams;
    },
  ) =>
    req<{
      ok: true;
      previewId: string;
      attempt: number;
      audioUrl: string;
      params: VoiceRegenerateParams;
    }>(`/api/mods/${modId}/voice/regenerate/${sessionId}/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  commitVoiceRegenerate: (modId: number, sessionId: string, previewId: string) =>
    req<{ ok: true; relPath: string; kept: 'original' | 'preview' }>(
      `/api/mods/${modId}/voice/regenerate/${sessionId}/commit`,
      {
        method: 'POST',
        body: JSON.stringify({ previewId }),
      },
    ),
  discardVoiceRegenerate: (modId: number, sessionId: string) =>
    req<{ ok: true }>(`/api/mods/${modId}/voice/regenerate/${sessionId}`, { method: 'DELETE' }),
  clearRows: (modId: number) =>
    req<ClearModRowsResult>(`/api/mods/${modId}/rows`, { method: 'DELETE' }),
  remove: (modId: number) => req<ClearModRowsResult>(`/api/mods/${modId}`, { method: 'DELETE' }),
  removeBatch: (modIds: number[]) =>
    req<DeleteModsBatchResult>(`/api/mods/batch-delete`, {
      method: 'POST',
      body: JSON.stringify({ modIds }),
    }),
  langs: (id: number) => req<string[]>(`/api/mods/${id}/langs`),
  clearSameAsSource: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    req<ClearSameAsSourceResult>(
      `/api/mods/${modId}/clear-same-as-source?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      { method: 'POST' },
    ),
  diff: (newModId: number, compareModId: number, targetLang = getTgtLang()) =>
    req<DiffResult>(
      `/api/mods/${newModId}/diff?compareModId=${compareModId}&targetLang=${targetLang}`,
    ),
  exportLangpack: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    downloadBinary(
      `/api/mods/${modId}/export/langpack?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      `mod_${modId}_${targetLang}_langpack.zip`,
    ),
  exportFullMod: (modId: number, srcLang = getSrcLang(), targetLang = getTgtLang()) =>
    downloadBinary(
      `/api/mods/${modId}/export/full-mod?srcLang=${encodeURIComponent(srcLang)}&targetLang=${encodeURIComponent(targetLang)}`,
      `mod_${modId}_${targetLang}.zip`,
    ),
  /** Copy translations from an older mod version into a newer one */
  carryOver: (newModId: number, fromModId: number, targetLang = getTgtLang()) =>
    req<CarryOverResult>(
      `/api/mods/${newModId}/carry-over?fromModId=${fromModId}&targetLang=${encodeURIComponent(targetLang)}`,
      { method: 'POST' },
    ),
  /** Apply imported raw strings (e.g. RU translation mod) to a base mod as translations */
  applyImported: (
    targetModId: number,
    fromModId: number,
    importedLang: string,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
  ) =>
    req<ApplyImportedResult>(
      `/api/mods/${targetModId}/apply-imported?fromModId=${fromModId}` +
        `&importedLang=${encodeURIComponent(importedLang)}` +
        `&srcLang=${encodeURIComponent(srcLang)}` +
        `&targetLang=${encodeURIComponent(targetLang)}`,
      { method: 'POST' },
    ),

  /** SSE-streaming apply-imported with progress. */
  async applyImportedStream(
    targetModId: number,
    fromModId: number,
    importedLang: string,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    onEvent?: (e: ApplyImportedStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<ApplyImportedJobSnapshot | null> {
    const response = await fetch(`${BASE}/api/mods/${targetModId}/apply-imported/stream`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromModId, importedLang, srcLang, targetLang }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let snapshot: ApplyImportedJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as ApplyImportedStreamEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              targetModId,
              fromModId,
              importedLang,
              status: 'running',
              done: 0,
              total: event.total,
              stats: { applied: 0, skipped: 0, unmatched: 0, empty: 0 },
              error: null,
            };
          }
          if (event.type === 'progress' && snapshot) {
            snapshot = {
              ...snapshot,
              done: event.done,
              total: event.total,
              stats: event.stats,
            };
          }
          if (event.type === 'done' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'completed',
              done: event.done,
              total: event.total,
              stats: event.stats,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              stats: event.stats,
            };
          }
          if (event.type === 'error') {
            if (snapshot) {
              snapshot = { ...snapshot, status: 'failed', error: event.error };
            }
            throw new Error(event.error);
          }
        } catch (e) {
          if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
        }
      }
    }
    return snapshot;
  },

  applyImportedStop: (jobId: number) =>
    req<{ ok: boolean }>(`/api/apply-imported/${jobId}/stop`, { method: 'POST' }),

  applyImportedStatus: (jobId: number) =>
    req<ApplyImportedJobSnapshot>(`/api/apply-imported/${jobId}`),
  /** List older versions (same mod name, different file hash) for a given mod ID */
  previousVersions: (modId: number) =>
    req<PreviousVersionRow[]>(`/api/mods/${modId}/previous-versions`),
};
