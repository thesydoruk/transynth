import { getSrcLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type { LlmSkipDetectJobSnapshot, LlmSkipDetectStreamEvent } from '../types';

export const llmSkipDetectEndpoints = {
  async start(
    modId: number,
    srcLang = getSrcLang(),
    opts?: {
      force?: boolean;
      useLlm?: boolean;
      persist?: boolean;
      onEvent?: (e: LlmSkipDetectStreamEvent) => void;
      signal?: AbortSignal;
    },
  ): Promise<LlmSkipDetectJobSnapshot | null> {
    const { force = false, useLlm = false, persist = true, onEvent, signal } = opts ?? {};
    const response = await fetch(`${BASE}/api/mods/${modId}/llm-skip-detect`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srcLang, force, useLlm, persist }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let snapshot: LlmSkipDetectJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as LlmSkipDetectStreamEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              candidates: [],
              error: null,
            };
          }
          if (event.type === 'progress' && snapshot) {
            snapshot = {
              ...snapshot,
              done: event.done,
              total: event.total,
              candidates: event.candidatesBatch
                ? [...snapshot.candidates, ...event.candidatesBatch]
                : event.candidate
                  ? [...snapshot.candidates, event.candidate]
                  : snapshot.candidates,
            };
          }
          if (event.type === 'done' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'completed',
              done: event.done,
              total: event.total,
              candidates: event.candidates ?? snapshot.candidates,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              candidates: event.candidates ?? snapshot.candidates,
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
    req<{ ok: boolean }>(`/api/llm-skip-detect/${jobId}/stop`, { method: 'POST' }),

  stopMod: (modId: number) =>
    req<{ ok: boolean }>(`/api/mods/${modId}/llm-skip-detect/stop`, { method: 'POST' }),

  status: (jobId: number) => req<LlmSkipDetectJobSnapshot>(`/api/llm-skip-detect/${jobId}`),
};
