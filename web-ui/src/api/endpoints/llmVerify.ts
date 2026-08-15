import { getSrcLang, getTgtLang } from '../../langDefaults';
import { BASE, req } from '../client';
import type { LlmVerifyJobSnapshot, LlmVerifyStreamEvent } from '../types';

export const llmVerifyEndpoints = {
  /** SSE-streaming LLM translation verification. Calls onEvent for each progress update. */
  async start(
    modId: number,
    srcLang = getSrcLang(),
    targetLang = getTgtLang(),
    onEvent?: (e: LlmVerifyStreamEvent) => void,
    autoApproveVerified = false,
    fixSuspicious = false,
    includeConfirmed = false,
    signal?: AbortSignal,
  ): Promise<LlmVerifyJobSnapshot | null> {
    const response = await fetch(`${BASE}/api/mods/${modId}/llm-verify`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcLang,
        targetLang,
        autoApproveVerified,
        fixSuspicious,
        includeConfirmed,
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
    let snapshot: LlmVerifyJobSnapshot | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as LlmVerifyStreamEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'started') {
            snapshot = {
              jobId: event.jobId,
              modId,
              status: 'running',
              done: 0,
              total: event.total,
              approved: 0,
              fixed: 0,
              issues: [],
              actionLog: [],
              error: null,
            };
          }
          if (event.type === 'progress' && snapshot) {
            snapshot = {
              ...snapshot,
              done: event.done,
              total: event.total,
              approved: event.approved,
              fixed: event.fixed,
              issues: event.issue ? [...snapshot.issues, event.issue] : snapshot.issues,
              actionLog: event.action ? [...snapshot.actionLog, event.action] : snapshot.actionLog,
            };
          }
          if (event.type === 'done' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'completed',
              done: event.done,
              total: event.total,
              approved: event.approved,
              fixed: event.fixed,
              issues: event.issues ?? snapshot.issues,
              actionLog: snapshot.actionLog,
            };
          }
          if (event.type === 'cancelled' && snapshot) {
            snapshot = {
              ...snapshot,
              status: 'cancelled',
              done: event.done,
              total: event.total,
              approved: event.approved,
              fixed: event.fixed,
              issues: event.issues ?? snapshot.issues,
              actionLog: snapshot.actionLog,
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

  async stop(jobId: number): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/api/llm-verify/${jobId}/stop`, {
      credentials: 'include',
      method: 'POST',
    });
    if (res.status === 404) return { ok: true };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ ok: boolean }>;
  },

  async stopMod(modId: number): Promise<{ ok: boolean }> {
    const res = await fetch(`${BASE}/api/mods/${modId}/llm-verify/stop`, {
      credentials: 'include',
      method: 'POST',
    });
    if (res.status === 404) return { ok: true };
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<{ ok: boolean }>;
  },

  status: (jobId: number) => req<LlmVerifyJobSnapshot>(`/api/llm-verify/${jobId}`),
};
