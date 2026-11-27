import { BASE, req } from '../client';
import type {
  VoiceEffortGameSummary,
  VoiceEffortJobSnapshot,
  VoiceEffortStreamEvent,
} from '../types';

/** The job's state after one event; progress before `started` has no job to belong to. */
const applyEvent = (
  snapshot: VoiceEffortJobSnapshot | null,
  event: Exclude<VoiceEffortStreamEvent, { type: 'error' }>,
  modId: number,
): VoiceEffortJobSnapshot | null => {
  if (event.type === 'started') {
    return {
      jobId: event.jobId,
      modId,
      status: 'running',
      done: 0,
      total: event.total,
      error: null,
      result: null,
    };
  }
  if (!snapshot) return null;
  if (event.type === 'progress') return { ...snapshot, done: event.done, total: event.total };
  if (event.type === 'done') {
    return {
      ...snapshot,
      status: 'completed',
      done: event.done,
      total: event.total,
      result: event.result,
    };
  }
  return { ...snapshot, status: 'cancelled', done: event.done, total: event.total };
};

/** Read one SSE stream of a `voice-effort` job; resolves with the last state it saw. */
const readEffortStream = async (
  response: Response,
  modId: number,
  onEvent?: (event: VoiceEffortStreamEvent) => void,
): Promise<VoiceEffortJobSnapshot | null> => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let snapshot: VoiceEffortJobSnapshot | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event: VoiceEffortStreamEvent;
      try {
        event = JSON.parse(line.slice(6)) as VoiceEffortStreamEvent;
      } catch {
        continue;
      }
      onEvent?.(event);
      if (event.type === 'error') throw new Error(event.error);
      snapshot = applyEvent(snapshot, event, modId);
    }
  }
  return snapshot;
};

export const voiceEffortAnalysisEndpoints = {
  /** Start measuring the mod's original takes; progress arrives as SSE events. */
  async start(
    modId: number,
    onEvent?: (event: VoiceEffortStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<VoiceEffortJobSnapshot | null> {
    const response = await fetch(`${BASE}/api/mods/${modId}/voice-effort`, {
      credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    }
    return readEffortStream(response, modId, onEvent);
  },

  stop: (jobId: number) =>
    req<{ ok: boolean }>(`/api/voice-effort/${jobId}/stop`, { method: 'POST' }),

  stopMod: (modId: number) =>
    req<{ ok: boolean }>(`/api/mods/${modId}/voice-effort/stop`, { method: 'POST' }),

  status: (jobId: number) => req<VoiceEffortJobSnapshot>(`/api/voice-effort/${jobId}`),

  gameSummary: (gameId: string) =>
    req<VoiceEffortGameSummary>(`/api/games/${encodeURIComponent(gameId)}/voice-effort-summary`),
};
