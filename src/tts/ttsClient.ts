import fs from 'node:fs';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import { ttsPool } from './ttsRequestPool';

export type TtsReferenceClip = {
  wavPath: string;
  /** Transcript of this clip (`speaker_texts[i]`). */
  speakerText?: string;
};

export type TtsSynthesizeOptions = {
  baseUrl?: string;
  language?: string;
  /** English / source transcript for a single `speaker_wav` (legacy). */
  speakerText?: string;
  timeoutMs?: number;
};

/** Build multipart body for Fish Speech (`POST /v1/synthesize`). */
export const buildSynthesisForm = (
  text: string,
  referenceWavs: Buffer[],
  options: TtsSynthesizeOptions & { speakerTexts?: string[] } = {},
): FormData => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('TTS text is empty');
  if (referenceWavs.length === 0) throw new Error('Reference audio is empty');
  for (const wav of referenceWavs) {
    if (wav.length === 0) throw new Error('Reference audio is empty');
  }

  const form = new FormData();
  form.append('text', trimmed);
  form.append('backend', 'fish-speech');
  referenceWavs.forEach((wav, index) => {
    form.append('speaker_wav', new Blob([wav], { type: 'audio/wav' }), `speaker_${index}.wav`);
  });
  if (options.language) form.append('language', options.language);

  const texts =
    options.speakerTexts?.map((t) => t.trim()) ??
    (options.speakerText != null ? [options.speakerText.trim()] : []);
  const hasTranscript = texts.some(Boolean);
  if (hasTranscript && texts.length === 1 && referenceWavs.length === 1) {
    form.append('speaker_text', texts[0]!);
  } else if (hasTranscript) {
    // Keep index alignment with speaker_wav (empty string when a clip has no transcript).
    while (texts.length < referenceWavs.length) texts.push('');
    for (const speakerText of texts.slice(0, referenceWavs.length)) {
      form.append('speaker_texts', speakerText);
    }
  }
  return form;
};

const readReferenceBuffers = (clips: TtsReferenceClip[]): Buffer[] =>
  clips.map((clip) => {
    const reference = fs.readFileSync(clip.wavPath);
    if (reference.length === 0) throw new Error(`Reference audio is empty: ${clip.wavPath}`);
    return reference;
  });

const normalizeClips = (
  references: string | TtsReferenceClip[],
  options: TtsSynthesizeOptions,
): TtsReferenceClip[] => {
  if (typeof references === 'string') {
    return [{ wavPath: references, speakerText: options.speakerText }];
  }
  if (references.length === 0) throw new Error('Reference audio is empty');
  return references;
};

const synthesizeWavHttp = async (
  text: string,
  references: string | TtsReferenceClip[],
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => {
  const clips = normalizeClips(references, options);
  const buffers = readReferenceBuffers(clips);
  const speakerTexts = clips.map((c) => c.speakerText?.trim() ?? '');

  const baseUrl = (options.baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const form = buildSynthesisForm(text, buffers, {
    ...options,
    speakerTexts: speakerTexts.some(Boolean) ? speakerTexts : undefined,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);

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
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timeout);
  }
};

/** Queue a Fish Speech synthesis request on the global concurrency pool. */
export const synthesizeWav = async (
  text: string,
  references: string | TtsReferenceClip[],
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => ttsPool.run(() => synthesizeWavHttp(text, references, options));

export const checkTtsHealth = async (baseUrl?: string): Promise<void> => {
  const root = (baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${root}/health`).catch(() => null);
  if (!response?.ok) {
    throw new Error('TTS health check failed');
  }

  const body = (await response.json().catch(() => null)) as {
    model_ready?: boolean;
    model_loaded?: boolean;
    status?: string;
  } | null;
  if (!body) return;

  const status = body.status?.toLowerCase();
  if (status === 'ok' || status === 'ready') return;

  const modelReady = body.model_ready ?? body.model_loaded;
  if (modelReady === false) {
    throw new Error(`TTS is not ready (status=${body.status ?? 'unknown'})`);
  }
};
