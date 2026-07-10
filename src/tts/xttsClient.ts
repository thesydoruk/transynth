import fs from 'node:fs';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import {
  appendXttsSynthesisFormFields,
  resolveTtsSynthesisParams,
  type XttsSynthesisParams,
} from './xttsSynthesisParams';

export type { XttsSynthesisParams } from './xttsSynthesisParams';
export { resolveTtsSynthesisParams, XTTS_GAME_DIALOGUE_DEFAULTS } from './xttsSynthesisParams';

export type XttsSynthesizeOptions = {
  baseUrl?: string;
  language?: string;
  timeoutMs?: number;
  synthesis?: Partial<XttsSynthesisParams>;
};

/** Call the external TTS HTTP API and return synthesized WAV bytes. */
export const synthesizeXttsWav = async (
  text: string,
  referenceWavPath: string,
  options: XttsSynthesizeOptions = {},
): Promise<Buffer> => {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('TTS text is empty');

  const reference = fs.readFileSync(referenceWavPath);
  if (reference.length === 0) throw new Error(`Reference audio is empty: ${referenceWavPath}`);

  const baseUrl = (options.baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const referenceBlob = new Blob([reference], { type: 'audio/wav' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);

  const form = new FormData();
  form.append('text', trimmed);
  form.append('speaker_wav', referenceBlob, 'speaker.wav');
  if (options.language) form.append('language', options.language);
  appendXttsSynthesisFormFields(form, resolveTtsSynthesisParams(options.synthesis));

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

export const checkXttsHealth = async (baseUrl?: string): Promise<void> => {
  const root = (baseUrl ?? resolveTtsBaseUrl()).replace(/\/$/, '');
  const response = await fetch(`${root}/health`).catch(() => null);
  if (!response?.ok) return;

  const body = (await response.json().catch(() => null)) as {
    model_ready?: boolean;
    model_loaded?: boolean;
    status?: string;
  } | null;
  const modelReady = body?.model_ready ?? body?.model_loaded;
  if (body && modelReady === false) {
    throw new Error(`TTS is not ready (status=${body.status ?? 'unknown'})`);
  }
};
