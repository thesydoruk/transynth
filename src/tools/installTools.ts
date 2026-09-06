import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import {
  resolveFonixDataPath,
  resolveXwmaEncodePath,
  voiceToolsDir,
} from '../voice/voiceToolPaths';
import { installVoiceTools, type InstallVoiceToolsResult } from './installVoiceTools';

export type InstallToolsResult = {
  voice: InstallVoiceToolsResult;
};

export type InstallToolsOptions = {
  force?: boolean;
  gameDir?: string;
};

let ensureInstallPromise: Promise<InstallToolsResult> | null = null;

const bundledFfmpegReady = (): boolean => {
  if (process.env.FFMPEG_PATH?.trim()) return fs.existsSync(process.env.FFMPEG_PATH.trim());
  if (process.platform !== 'win32') return true;
  return fs.existsSync(path.join(voiceToolsDir(), 'ffmpeg.exe'));
};

const voiceReady = (): boolean =>
  fs.existsSync(resolveFonixDataPath()) &&
  fs.existsSync(resolveXwmaEncodePath()) &&
  bundledFfmpegReady();

/**
 * Install disk voice tools (Fonix, xWMA, ffmpeg).
 * FaceFXWrapper and Champollion are baked into Docker images.
 */
export const installTools = async (opts?: InstallToolsOptions): Promise<InstallToolsResult> => {
  const gameDirs = opts?.gameDir?.trim() ? [opts.gameDir.trim()] : [];
  const voice = await installVoiceTools({ force: opts?.force, gameDirs });
  return { voice };
};

/**
 * Ensure voice-localization tools are available (auto-install when using default paths).
 */
export const ensureVoiceToolsInstalled = async (gameDir?: string): Promise<void> => {
  const usesCustomPaths = Boolean(
    process.env.FONIX_DATA_PATH?.trim() || process.env.XWMA_ENCODE_PATH?.trim(),
  );

  if (usesCustomPaths) {
    const missing: string[] = [];
    if (!fs.existsSync(resolveFonixDataPath())) {
      missing.push(`FonixData.cdf (${resolveFonixDataPath()})`);
    }
    if (!fs.existsSync(resolveXwmaEncodePath())) {
      missing.push(`xWMAEncode (${resolveXwmaEncodePath()})`);
    }
    if (missing.length > 0) {
      throw new Error(`Missing voice tooling:\n  - ${missing.join('\n  - ')}`);
    }
    return;
  }

  if (voiceReady()) return;

  const result = await installVoiceTools({ gameDirs: gameDir ? [gameDir] : [] });
  if (!voiceReady()) {
    const hint = result.warnings.length > 0 ? `\n${result.warnings.join('\n')}` : '';
    throw new Error(`Voice tooling install incomplete — run \`npm run tools:install\`${hint}`);
  }
};

/**
 * Install all tools if anything is missing from the default bundle locations.
 */
export const ensureToolsInstalled = async (gameDir?: string): Promise<InstallToolsResult> => {
  if (voiceReady()) {
    return installTools({ gameDir });
  }

  if (!ensureInstallPromise) {
    log.info('External tools missing — running bundled installer…');
    ensureInstallPromise = installTools({ gameDir }).finally(() => {
      ensureInstallPromise = null;
    });
  }

  return ensureInstallPromise;
};
