import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type {
  ModVoiceGenerateJobSnapshot,
  ModVoiceGenerateScope,
  ModVoiceGenerateStreamEvent,
} from '../types';

export const voiceGenerateEndpoints = {
  async start(
    modId: number,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    onEvent?: (e: ModVoiceGenerateStreamEvent) => void,
    signal?: AbortSignal,
    scope: ModVoiceGenerateScope = 'missing',
    speakerKey?: string,
  ): Promise<ModVoiceGenerateJobSnapshot | null> {
    const response = await fetch(`${BASE}/api/mods/${modId}/voice-generate`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcLang,
        targetLang,
        scope,
        ...(speakerKey?.trim() ? { speakerKey: speakerKey.trim() } : {}),
      }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let snapshot: ModVoiceGenerateJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as ModVoiceGenerateStreamEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              written: 0,
              skipped: 0,
              warningCount: 0,
              error: null,
            };
          }
          if (event.type === 'progress' && snapshot) {
            snapshot = { ...snapshot, done: event.done, total: event.total };
          }
          if (event.type === 'done' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'completed',
              done: event.done,
              total: event.total,
              written: event.written,
              skipped: event.skipped,
              warningCount: event.warningCount,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
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

  stop: (jobId: number) =>
    req<{ ok: boolean }>(`/api/voice-generate/${jobId}/stop`, { method: 'POST' }),

  stopMod: (modId: number) =>
    req<{ ok: boolean }>(`/api/mods/${modId}/voice-generate/stop`, { method: 'POST' }),

  status: (jobId: number) => req<ModVoiceGenerateJobSnapshot>(`/api/voice-generate/${jobId}`),
};
