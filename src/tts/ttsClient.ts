import fs from 'node:fs';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import { ttsPool } from './ttsRequestPool';
import {
  appendTtsSynthesisFormFields,
  resolveTtsSynthesisParams,
  type TtsSynthesisParams,
} from './ttsSynthesisParams';

export type { TtsSynthesisParams } from './ttsSynthesisParams';
export { resolveTtsSynthesisParams, TTS_SYNTHESIS_DEFAULTS } from './ttsSynthesisParams';

export type TtsSynthesizeOptions = {
  baseUrl?: string;
  language?: string;
  /** English transcript of `speaker_wav` (Fish Speech `speaker_text`). */
  speakerText?: string;
  timeoutMs?: number;
  synthesis?: Partial<TtsSynthesisParams>;
};

/** Build multipart body for Fish Speech (`POST /v1/synthesize`). */
export const buildSynthesisForm = (
  text: string,
  referenceWav: Buffer,
  options: TtsSynthesizeOptions = {},
): FormData => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('TTS text is empty');
  if (referenceWav.length === 0) throw new Error('Reference audio is empty');

  const form = new FormData();
  form.append('text', trimmed);
  form.append('backend', 'fish-speech');
  form.append('speaker_wav', new Blob([referenceWav], { type: 'audio/wav' }), 'speaker.wav');
  if (options.language) form.append('language', options.language);
  const speakerText = options.speakerText?.trim();
  if (speakerText) form.append('speaker_text', speakerText);
  appendTtsSynthesisFormFields(form, resolveTtsSynthesisParams(options.synthesis));
  return form;
};

const synthesizeWavHttp = async (
  text: string,
  referenceWavPath: string,
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => {
  const reference = fs.readFileSync(referenceWavPath);
  if (reference.length === 0) throw new Error(`Reference audio is empty: ${referenceWavPath}`);

  const baseUrl = (options.baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const form = buildSynthesisForm(text, reference, options);
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
  referenceWavPath: string,
  options: TtsSynthesizeOptions = {},
): Promise<Buffer> => ttsPool.run(() => synthesizeWavHttp(text, referenceWavPath, options));

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
