import { resolveAudioIntelBaseUrl } from './baseUrl';

/** What audio-intel's `/health` reports (2.2+ adds the lanes, models and GPU figures). */
export type AudioIntelHealthBody = {
  status?: string;
  version?: string;
  model?: string;
  diarization_enabled?: boolean;
  alignment_enabled?: boolean;
  requests?: { in_flight: number; queued: number; max: number; queue_max: number };
  batch?: { running: number; queued: number; max: number; queue_max: number };
  gpu_tokens?: { in_use: number; waiting: number; max: number };
  models?: { groups: Record<string, { resident: boolean; in_use: number; idle_s: number | null }> };
  gpu?: { device: string; vram_total_mb: number; vram_used_mb: number } | null;
};

export type AudioIntelHealthResult =
  | { ok: true; body: AudioIntelHealthBody | null }
  | { ok: false; error: string };

/** Probe audio-intel `GET /health` without throwing. */
export const probeAudioIntelHealth = async (
  baseUrl?: string,
  signal?: AbortSignal,
): Promise<AudioIntelHealthResult> => {
  const root = (baseUrl ?? resolveAudioIntelBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${root}/health`, { signal }).catch(() => null);
  if (!response?.ok) {
    return { ok: false, error: `audio-intel health check failed (${root}/health)` };
  }

  const body = (await response.json().catch(() => null)) as AudioIntelHealthBody | null;
  if (!body) return { ok: true, body: null };

  const status = body.status?.toLowerCase();
  if (status && status !== 'ok' && status !== 'ready') {
    return { ok: false, error: `audio-intel is not ready (status=${body.status})` };
  }
  return { ok: true, body };
};

/** Throw when audio-intel is not reachable. */
export const checkAudioIntelHealth = async (baseUrl?: string): Promise<void> => {
  const result = await probeAudioIntelHealth(baseUrl);
  if (!result.ok) throw new Error(result.error);
};
