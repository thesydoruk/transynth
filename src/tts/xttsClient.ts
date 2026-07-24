import fs from 'node:fs';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import { ttsPool } from './ttsRequestPool';
import {
  appendXttsSynthesisFormFields,
  resolveTtsSynthesisParams,
  type XttsSynthesisParams,
} from './xttsSynthesisParams';

export type { XttsSynthesisParams } from './xttsSynthesisParams';
export { resolveTtsSynthesisParams, XTTS_GAME_DIALOGUE_DEFAULTS } from './xttsSynthesisParams';

/** TTS model backend on the xtts-engine server (`POST /v1/synthesize` `backend` field). */
export type TtsBackend = 'xtts' | 'fish-speech';

export type XttsSynthesizeOptions = {
  baseUrl?: string;
  /** Overrides server `inference.default_backend` when set. */
  backend?: TtsBackend;
  language?: string;
  /** English transcript of `speaker_wav` (Fish Speech `speaker_text`). */
  speakerText?: string;
  timeoutMs?: number;
  synthesis?: Partial<XttsSynthesisParams>;
};

/** Build multipart body for `POST /v1/synthesize`. */
export const buildXttsSynthesisForm = (
  text: string,
  referenceWav: Buffer,
  options: XttsSynthesizeOptions = {},
): FormData => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('TTS text is empty');
  if (referenceWav.length === 0) throw new Error('Reference audio is empty');

  const form = new FormData();
  form.append('text', trimmed);
  form.append('speaker_wav', new Blob([referenceWav], { type: 'audio/wav' }), 'speaker.wav');
  if (options.backend) form.append('backend', options.backend);
  if (options.language) form.append('language', options.language);
  const speakerText = options.speakerText?.trim();
  if (speakerText) form.append('speaker_text', speakerText);
  appendXttsSynthesisFormFields(form, resolveTtsSynthesisParams(options.synthesis));
  return form;
};

/** Call the external TTS HTTP API and return synthesized WAV bytes. */
const synthesizeXttsWavHttp = async (
  text: string,
  referenceWavPath: string,
  options: XttsSynthesizeOptions = {},
): Promise<Buffer> => {
  const reference = fs.readFileSync(referenceWavPath);
  if (reference.length === 0) throw new Error(`Reference audio is empty: ${referenceWavPath}`);

  const baseUrl = (options.baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const form = buildXttsSynthesisForm(text, reference, options);
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

/** Queue a TTS synthesis request on the per-backend concurrency pool. */
export const synthesizeXttsWav = async (
  text: string,
  referenceWavPath: string,
  options: XttsSynthesizeOptions = {},
): Promise<Buffer> =>
  ttsPool.run(options.backend, () => synthesizeXttsWavHttp(text, referenceWavPath, options));

export const checkXttsHealth = async (baseUrl?: string): Promise<void> => {
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
  // Servers that report status=ok are reachable; model_loaded may stay false until first synthesis.
  if (status === 'ok' || status === 'ready') return;

  const modelReady = body.model_ready ?? body.model_loaded;
  if (modelReady === false) {
    throw new Error(`TTS is not ready (status=${body.status ?? 'unknown'})`);
  }
};
