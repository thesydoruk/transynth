import path from 'node:path';
import { PATHS, resolveDir } from '../paths';

/** Where `npm run tools:install` puts `FonixData.cdf` for the bethesda-tools sidecar to mount. */
export const voiceToolsDir = (): string =>
  resolveDir(process.env.VOICE_TOOLS_DIR ?? path.join(PATHS.toolsDir, 'voice'));

export const resolveFonixDataPath = (): string => {
  const configured = process.env.FONIX_DATA_PATH?.trim();
  if (configured) return configured;
  return path.join(voiceToolsDir(), 'FonixData.cdf');
};

/** The distro's ffmpeg (the web and worker images install it), or `FFMPEG_PATH`. */
export const resolveFfmpegPath = (): string => process.env.FFMPEG_PATH?.trim() || 'ffmpeg';

export const resolveTtsBaseUrl = (): string => {
  const explicit = process.env.TTS_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return 'http://localhost:8080';
};

/** Map mod target locale to the TTS API `language` field. */
export const resolveTtsLanguage = (targetLang: string): string => {
  const lang = targetLang.trim().toLowerCase();
  if (!lang) throw new Error('Target language is required for TTS');
  return lang === 'ua' ? 'uk' : lang;
};

/** How Fish Speech picks the English reference clip sent with each synthesis request. */
export type TtsReferenceMode = 'speaker' | 'line';

/**
 * Default TTS reference mode when project settings are unavailable (CLI).
 *
 * - `line` — always the same voiced line's original English audio (per row).
 * - `speaker` — one shared clip per NPC folder (auto / DB pick / `_reference.wav`).
 */
export const resolveTtsReferenceMode = (): TtsReferenceMode => 'speaker';
