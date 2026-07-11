import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';

export const voiceToolsDir = (): string =>
  path.resolve(process.env.VOICE_TOOLS_DIR ?? path.join(PATHS.dataDir, 'tools', 'voice'));

export const resolveFaceFxWrapperPath = (): string => {
  const configured = process.env.FACEFX_WRAPPER_PATH?.trim();
  if (configured) return configured;
  return path.join(voiceToolsDir(), 'FaceFXWrapper.exe');
};

export const resolveFonixDataPath = (): string => {
  const configured = process.env.FONIX_DATA_PATH?.trim();
  if (configured) return configured;
  return path.join(voiceToolsDir(), 'FonixData.cdf');
};

export const resolveXwmaEncodePath = (): string => {
  const configured = process.env.XWMA_ENCODE_PATH?.trim();
  if (configured) return configured;
  return path.join(voiceToolsDir(), 'xWMAEncode.exe');
};

export const resolveFfmpegPath = (): string => {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) return configured;
  const bundled = path.join(voiceToolsDir(), 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'ffmpeg';
};

export const resolveTtsBaseUrl = (): string => {
  const explicit = process.env.TTS_BASE_URL?.trim() || process.env.XTTS_UK_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = process.env.XTTS_UK_PORT?.trim() || '8020';
  return `http://localhost:${port}`;
};

/** TTS synthesis language — defaults to `uk` for the Ukrainian voice model. */
export const resolveTtsLanguage = (): string => {
  const lang = (
    process.env.TTS_LANGUAGE?.trim() ||
    process.env.XTTS_UK_LANGUAGE?.trim() ||
    'uk'
  ).toLowerCase();
  return lang === 'ua' ? 'uk' : lang;
};

/** @deprecated Use {@link resolveTtsBaseUrl}. */
export const resolveXttsUkBaseUrl = resolveTtsBaseUrl;

/** @deprecated Use {@link resolveTtsLanguage}. */
export const resolveXttsUkLanguage = resolveTtsLanguage;

/** How XTTS picks the English reference clip sent with each synthesis request. */
export type TtsReferenceMode = 'speaker' | 'line';

const readEnvOn = (name: string): boolean | undefined => {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return undefined;
};

/**
 * Resolve XTTS reference mode from env.
 *
 * - `line` — always the same voiced line's original English audio (per row).
 * - `speaker` — one shared clip per NPC folder (auto / DB pick / `_reference.wav`).
 */
export const resolveTtsReferenceMode = (): TtsReferenceMode => {
  if (readEnvOn('TTS_LINE_REFERENCE') === true) return 'line';

  const speakerRaw = process.env.TTS_SPEAKER_REFERENCE?.trim().toLowerCase();
  if (speakerRaw && ['0', 'false', 'no', 'off'].includes(speakerRaw)) return 'line';

  return 'speaker';
};

/** Pick the cleanest per-NPC reference clip for XTTS (default on). Set `TTS_SPEAKER_REFERENCE=0` or `TTS_LINE_REFERENCE=1` for per-line references. */
export const resolveSpeakerReferenceEnabled = (): boolean =>
  resolveTtsReferenceMode() === 'speaker';

export const assertVoiceTooling = (): void => {
  const missing: string[] = [];
  const faceFx = resolveFaceFxWrapperPath();
  const fonix = resolveFonixDataPath();
  const xwma = resolveXwmaEncodePath();
  if (!fs.existsSync(faceFx)) missing.push(`FaceFXWrapper (${faceFx})`);
  if (!fs.existsSync(fonix)) missing.push(`FonixData.cdf (${fonix})`);
  if (!fs.existsSync(xwma)) missing.push(`xWMAEncode (${xwma})`);
  if (missing.length > 0) {
    throw new Error(
      `Missing voice tooling:\n  - ${missing.join('\n  - ')}\nRun \`npm run tools:install\` or set FACEFX_WRAPPER_PATH / FONIX_DATA_PATH / XWMA_ENCODE_PATH`,
    );
  }
};
