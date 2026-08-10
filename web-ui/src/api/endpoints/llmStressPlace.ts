import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type { LlmStressPlaceJobSnapshot, LlmStressPlaceStreamEvent } from '../types';
import type { ModStressPlaceScope } from '../types/llmJobs';

export const llmStressPlaceEndpoints = {
  async start(
    modId: number,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    opts?: {
      scope?: ModStressPlaceScope;
      speakerKey?: string;
      force?: boolean;
      onEvent?: (e: LlmStressPlaceStreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<LlmStressPlaceJobSnapshot | null> {
    const { scope = 'missing', speakerKey, force = false, onEvent, signal } = opts ?? {};
    const response = await fetch(`${BASE}/api/mods/${modId}/llm-stress-place`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcLang,
        targetLang,
        scope,
        force,
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
    let snapshot: LlmStressPlaceJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as LlmStressPlaceStreamEvent;
          onEvent?.(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              placedCount: 0,
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
              placedCount: event.placedCount,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              placedCount: event.placedCount,
            };
          }
          if (event.type === 'error') {
            if (snapshot) snapshot = { ...snapshot, status: 'failed', error: event.error };
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
    req<{ ok: boolean }>(`/api/llm-stress-place/${jobId}/stop`, { method: 'POST' }),

  stopMod: (modId: number) =>
    req<{ ok: boolean }>(`/api/mods/${modId}/llm-stress-place/stop`, { method: 'POST' }),

  status: (jobId: number) => req<LlmStressPlaceJobSnapshot>(`/api/llm-stress-place/${jobId}`),
};
