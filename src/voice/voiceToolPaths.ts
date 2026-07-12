import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';
import { isWineAvailable, isWineExePath } from './voiceExec';

export const voiceToolsDir = (): string =>
  path.resolve(process.env.VOICE_TOOLS_DIR ?? path.join(PATHS.toolsDir, 'voice'));

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

/** Map mod target locale to the TTS API `language` field. */
export const resolveTtsLanguage = (targetLang: string): string => {
  const lang = targetLang.trim().toLowerCase();
  if (!lang) throw new Error('Target language is required for TTS');
  return lang === 'ua' ? 'uk' : lang;
};

/** How XTTS picks the English reference clip sent with each synthesis request. */
export type TtsReferenceMode = 'speaker' | 'line';

/**
 * Default XTTS reference mode when project settings are unavailable (CLI).
 *
 * - `line` — always the same voiced line's original English audio (per row).
 * - `speaker` — one shared clip per NPC folder (auto / DB pick / `_reference.wav`).
 */
export const resolveTtsReferenceMode = (): TtsReferenceMode => 'speaker';

const assertVoiceToolFile = (label: string, toolPath: string, missing: string[]): void => {
  if (!fs.existsSync(toolPath)) {
    missing.push(`${label} (${toolPath})`);
    return;
  }
  if (process.platform !== 'win32' && isWineExePath(toolPath) && !isWineAvailable()) {
    missing.push(`Wine (required to run ${label} on Linux — install wine/wine32 or set WINE_PATH)`);
  }
};

export const assertVoiceTooling = (): void => {
  const missing: string[] = [];
  assertVoiceToolFile('FaceFXWrapper', resolveFaceFxWrapperPath(), missing);
  const fonix = resolveFonixDataPath();
  if (!fs.existsSync(fonix)) missing.push(`FonixData.cdf (${fonix})`);
  assertVoiceToolFile('xWMAEncode', resolveXwmaEncodePath(), missing);
  if (missing.length > 0) {
    throw new Error(
      `Missing voice tooling:\n  - ${missing.join('\n  - ')}\nRun \`npm run tools:install\` or set FACEFX_WRAPPER_PATH / FONIX_DATA_PATH / XWMA_ENCODE_PATH`,
    );
  }
};
