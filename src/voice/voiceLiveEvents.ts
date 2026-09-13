/**
 * Per-line voice synthesis events for the editor live stream.
 *
 * The worker (bulk job) and the API (one-off generate) emit these; Redis
 * fans them out to every open `/voice/live` SSE on the web process.
 */

export const VOICE_LIVE_CHANNEL = 'transynth:voice:live';

export type VoiceLiveLineEvent = {
  type: 'line_started' | 'line_done' | 'line_failed';
  modId: number;
  speakerKey: string;
  formidLower6: string;
  variant: number;
  voiceSimilarity?: number | null;
};

export type VoiceLiveSseEvent = VoiceLiveLineEvent | { type: 'ping' };

type VoiceLiveSink = (event: VoiceLiveLineEvent) => void;

let sink: VoiceLiveSink | null = null;

/** Process-local hook (web / worker register the Redis publisher at boot). */
export const setVoiceLiveSink = (next: VoiceLiveSink | null): void => {
  sink = next;
};

/** Fire-and-forget; a missing or throwing sink must not break TTS. */
export const emitVoiceLive = (event: VoiceLiveLineEvent): void => {
  try {
    sink?.(event);
  } catch {
    /* live UI must not interrupt synthesis */
  }
};

const isVoiceLiveType = (value: unknown): value is VoiceLiveLineEvent['type'] =>
  value === 'line_started' || value === 'line_done' || value === 'line_failed';

export const parseVoiceLiveEvent = (value: unknown): VoiceLiveLineEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!isVoiceLiveType(raw.type)) return null;
  const modId = Number(raw.modId);
  const variant = Number(raw.variant);
  const speakerKey = typeof raw.speakerKey === 'string' ? raw.speakerKey : '';
  const formidLower6 = typeof raw.formidLower6 === 'string' ? raw.formidLower6 : '';
  if (!Number.isInteger(modId) || modId < 1) return null;
  if (!Number.isInteger(variant) || variant < 1) return null;
  if (!speakerKey || !formidLower6) return null;
  const event: VoiceLiveLineEvent = {
    type: raw.type,
    modId,
    speakerKey,
    formidLower6,
    variant,
  };
  if (raw.type === 'line_done' && 'voiceSimilarity' in raw) {
    const score = raw.voiceSimilarity;
    event.voiceSimilarity = typeof score === 'number' && Number.isFinite(score) ? score : null;
  }
  return event;
};

export const voiceLiveLineKey = (event: {
  speakerKey: string;
  formidLower6: string;
  variant: number;
}): string => `${event.speakerKey}:${event.formidLower6}:${event.variant}`;
