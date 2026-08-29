import { getSrcLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type { LlmGenderDetectJobSnapshot, LlmGenderDetectStreamEvent } from '../types';

export const llmGenderDetectEndpoints = {
  async start(
    modId: number,
    srcLang = getSrcLang(),
    opts?: {
      force?: boolean;
      useLlm?: boolean;
      onEvent?: (e: LlmGenderDetectStreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<LlmGenderDetectJobSnapshot | null> {
    const { force = false, useLlm = true, onEvent, signal } = opts ?? {};
    const response = await fetch(`${BASE}/api/mods/${modId}/llm-gender-detect`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srcLang, force, useLlm }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let snapshot: LlmGenderDetectJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as LlmGenderDetectStreamEvent;
          onEvent?.(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              resolvedCount: 0,
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
              resolvedCount: event.resolvedCount,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              resolvedCount: event.resolvedCount,
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
    req<{ ok: boolean }>(`/api/llm-gender-detect/${jobId}/stop`, { method: 'POST' }),

  stopMod: (modId: number) =>
    req<{ ok: boolean }>(`/api/mods/${modId}/llm-gender-detect/stop`, { method: 'POST' }),

  status: (jobId: number) => req<LlmGenderDetectJobSnapshot>(`/api/llm-gender-detect/${jobId}`),
};
