import fs from 'node:fs';
import { log } from '../logger';
import { ensureDependencyHealthy } from '../pipeline/waitForHealthy';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import { ttsPool } from './ttsRequestPool';
import {
  appendTtsSynthesisFormFields,
  resolveTtsSynthesisParams,
  type TtsSynthesisParams,
} from './ttsSynthesisParams';

export { checkTtsHealth, probeTtsHealth } from './ttsHealth';
export type { TtsSynthesisParams } from './ttsSynthesisParams';
export { resolveTtsSynthesisParams, TTS_SYNTHESIS_DEFAULTS } from './ttsSynthesisParams';

/** Fish Speech sets this when the WAV is still silence or a cutoff after retries. */
export const TTS_SYNTH_WARNING_HEADER = 'x-synth-warning';

const TTS_WARNING_TEXT_LIMIT = 160;

export const readSynthWarning = (headers: Headers): string =>
  headers.get(TTS_SYNTH_WARNING_HEADER)?.trim() ?? '';

const logSynthWarning = (warning: string, text: string): void => {
  const clipped = text.trim().replace(/\s+/g, ' ');
  const preview =
    clipped.length > TTS_WARNING_TEXT_LIMIT
      ? `${clipped.slice(0, TTS_WARNING_TEXT_LIMIT)}…`
      : clipped;
  log.warn('TTS suspicious take kept', { warning, text: preview });
};

export type TtsReferenceInput = {
  wavPath: string;
  speakerText?: string | null;
};

export type TtsSynthesizeOptions = {
  baseUrl?: string;
  language?: string;
  /** English transcript of a single `speaker_wav` (Fish Speech `speaker_text`). */
  speakerText?: string;
  timeoutMs?: number;
  synthesis?: Partial<TtsSynthesisParams>;
  /** Abort an in-flight Fish Speech request (job Stop). */
  signal?: AbortSignal;
};

export type TtsFormReference = {
  wav: Buffer;
  speakerText?: string | null;
};

const toFormReferences = (
  reference: Buffer | TtsFormReference[],
  speakerText?: string,
): TtsFormReference[] => {
  if (Buffer.isBuffer(reference)) return [{ wav: reference, speakerText }];
  if (reference.length === 0) throw new Error('Reference audio is empty');
  return reference;
};

/** One transcript per clip. Multi-ref uses `speaker_texts`; a single clip uses `speaker_text`. */
const speakerTextsForClips = (
  clips: TtsFormReference[],
  fallback: string,
): Array<string | undefined> => {
  if (clips.length <= 1) {
    const text = clips[0]?.speakerText?.trim();
    return [text || undefined];
  }
  const firstKnown = clips.map((clip) => clip.speakerText?.trim()).find(Boolean) ?? fallback;
  return clips.map((clip) => clip.speakerText?.trim() || firstKnown);
};

/** Build multipart body for Fish Speech (`POST /v1/synthesize`). */
export const buildSynthesisForm = (
  text: string,
  reference: Buffer | TtsFormReference[],
  options: TtsSynthesizeOptions = {},
): FormData => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('TTS text is empty');
  const clips = toFormReferences(reference, options.speakerText);
  const form = new FormData();
  form.append('text', trimmed);
  form.append('backend', 'fish-speech');
  if (options.language) form.append('language', options.language);
  const texts = speakerTextsForClips(clips, trimmed);
  clips.forEach((clip, index) => {
    if (clip.wav.length === 0) throw new Error('Reference audio is empty');
    form.append('speaker_wav', new Blob([clip.wav], { type: 'audio/wav' }), `speaker-${index}.wav`);
  });
  if (clips.length <= 1) {
    const clipText = texts[0];
    if (clipText) form.append('speaker_text', clipText);
  } else {
    for (const clipText of texts) {
      form.append('speaker_texts', clipText ?? '');
    }
  }
  appendTtsSynthesisFormFields(form, resolveTtsSynthesisParams(options.synthesis));
  return form;
};

const readReferenceClips = (
  reference: string | TtsReferenceInput[],
  speakerText?: string,
): TtsFormReference[] => {
  const inputs = typeof reference === 'string' ? [{ wavPath: reference, speakerText }] : reference;
  if (inputs.length === 0) throw new Error('Reference audio is empty');
  return inputs.map((clip) => {
    const wav = fs.readFileSync(clip.wavPath);
    if (wav.length === 0) throw new Error(`Reference audio is empty: ${clip.wavPath}`);
    return { wav, speakerText: clip.speakerText };
  });
};

const synthesizeWavHttp = async (
  text: string,
  reference: string | TtsReferenceInput[],
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => {
  const clips = readReferenceClips(reference, options.speakerText);
  const baseUrl = (options.baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const form = buildSynthesisForm(text, clips, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/v1/synthesize`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`TTS HTTP ${response.status}: ${detail || response.statusText}`);
    }
    const warning = readSynthWarning(response.headers);
    if (warning) logSynthWarning(warning, text);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    clearTimeout(timeout);
  }
};

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Voice generation cancelled', 'AbortError');
};

/** Queue a Fish Speech synthesis request on the global concurrency pool. */
export const synthesizeWav = async (
  text: string,
  reference: string | TtsReferenceInput[],
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => {
  throwIfAborted(options.signal);
  await ensureDependencyHealthy('tts');
  throwIfAborted(options.signal);
  return ttsPool.run(() => {
    throwIfAborted(options.signal);
    return synthesizeWavHttp(text, reference, options);
  });
};
