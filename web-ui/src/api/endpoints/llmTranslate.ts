import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type { LlmTranslateJobSnapshot, LlmTranslateStreamEvent } from '../types';

export const llmTranslateEndpoints = {
  async start(
    modId: number,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    onEvent?: (e: LlmTranslateStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<LlmTranslateJobSnapshot | null> {
    const response = await fetch(`${BASE}/api/mods/${modId}/llm-translate`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srcLang, targetLang }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let snapshot: LlmTranslateJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as LlmTranslateStreamEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              rows: [],
              error: null,
            };
          }
          if (event.type === 'progress' && snapshot) {
            snapshot = {
              ...snapshot,
              done: event.done,
              total: event.total,
              rows: event.row ? [...snapshot.rows, event.row] : snapshot.rows,
            };
          }
          if (event.type === 'done' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'completed',
              done: event.done,
              total: event.total,
              rows: event.rows,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              rows: event.rows,
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
    req<{ ok: boolean }>(`/api/llm-translate/${jobId}/stop`, { method: 'POST' }),

  status: (jobId: number) => req<LlmTranslateJobSnapshot>(`/api/llm-translate/${jobId}`),
};
