import { resolveAudioIntelBaseUrl } from './baseUrl';

export type AudioIntelHealthResult = { ok: true } | { ok: false; error: string };

/** Probe audio-intel `GET /health` without throwing. */
export const probeAudioIntelHealth = async (baseUrl?: string): Promise<AudioIntelHealthResult> => {
  const root = (baseUrl ?? resolveAudioIntelBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${root}/health`).catch(() => null);
  if (!response?.ok) {
    return { ok: false, error: `audio-intel health check failed (${root}/health)` };
  }

  const body = (await response.json().catch(() => null)) as { status?: string } | null;
  if (!body) return { ok: true };

  const status = body.status?.toLowerCase();
  if (status && status !== 'ok' && status !== 'ready') {
    return { ok: false, error: `audio-intel is not ready (status=${body.status})` };
  }
  return { ok: true };
};

/** Throw when audio-intel is not reachable. */
export const checkAudioIntelHealth = async (baseUrl?: string): Promise<void> => {
  const result = await probeAudioIntelHealth(baseUrl);
  if (!result.ok) throw new Error(result.error);
};
