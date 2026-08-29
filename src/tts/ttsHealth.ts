import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';

export type TtsHealthResult = { ok: true } | { ok: false; error: string };

/** Probe Fish Speech `GET /health` without throwing. */
export const probeTtsHealth = async (baseUrl?: string): Promise<TtsHealthResult> => {
  const root = (baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${root}/health`).catch(() => null);
  if (!response?.ok) {
    return { ok: false, error: `TTS health check failed (${root}/health)` };
  }

  const body = (await response.json().catch(() => null)) as {
    model_ready?: boolean;
    model_loaded?: boolean;
    status?: string;
  } | null;
  if (!body) return { ok: true };

  const status = body.status?.toLowerCase();
  if (status === 'ok' || status === 'ready') return { ok: true };

  const modelReady = body.model_ready ?? body.model_loaded;
  if (modelReady === false) {
    return { ok: false, error: `TTS is not ready (status=${body.status ?? 'unknown'})` };
  }
  return { ok: true };
};

/** Throw when the TTS server is not ready. */
export const checkTtsHealth = async (baseUrl?: string): Promise<void> => {
  const result = await probeTtsHealth(baseUrl);
  if (!result.ok) throw new Error(result.error);
};
