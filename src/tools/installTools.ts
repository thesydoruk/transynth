import fs from 'node:fs';
import path from 'node:path';
import {
  CHAMPOLLION_VERSION,
  defaultChampollionExePath,
  isChampollionInstalled,
  readInstalledChampollionVersion,
} from '../champollionPath';
import { log } from '../logger';
import {
  resolveFaceFxWrapperPath,
  resolveFfmpegPath,
  resolveFonixDataPath,
  resolveXwmaEncodePath,
  voiceToolsDir,
} from '../voice/voiceToolPaths';
import { installChampollion, type InstallChampollionResult } from './installChampollion';
import { installVoiceTools, type InstallVoiceToolsResult } from './installVoiceTools';

export type InstallToolsResult = {
  champollion: InstallChampollionResult;
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
  fs.existsSync(resolveFaceFxWrapperPath()) &&
  fs.existsSync(resolveFonixDataPath()) &&
  fs.existsSync(resolveXwmaEncodePath()) &&
  bundledFfmpegReady();

const champollionReady = (): boolean =>
  isChampollionInstalled() && readInstalledChampollionVersion() === CHAMPOLLION_VERSION;

/**
 * Install all bundled external tools (Champollion + voice pipeline dependencies).
 */
export const installTools = async (opts?: InstallToolsOptions): Promise<InstallToolsResult> => {
  const gameDirs = opts?.gameDir?.trim() ? [opts.gameDir.trim()] : [];
  const champollion = await installChampollion({ force: opts?.force });
  const voice = await installVoiceTools({ force: opts?.force, gameDirs });
  return { champollion, voice };
};

/**
 * Ensure Champollion is available (auto-install into default path when unset).
 */
export const ensureChampollionInstalled = async (): Promise<string> => {
  const configured = process.env.CHAMPOLLION_PATH?.trim();
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    throw new Error(`CHAMPOLLION_PATH not found: ${configured}`);
  }

  const exePath = defaultChampollionExePath();
  if (champollionReady()) return exePath;

  await installChampollion();
  return exePath;
};

/**
 * Ensure voice-localization tools are available (auto-install when using default paths).
 */
export const ensureVoiceToolsInstalled = async (gameDir?: string): Promise<void> => {
  const usesCustomPaths = Boolean(
    process.env.FACEFX_WRAPPER_PATH?.trim() ||
    process.env.FONIX_DATA_PATH?.trim() ||
    process.env.XWMA_ENCODE_PATH?.trim(),
  );

  if (usesCustomPaths) {
    const missing: string[] = [];
    if (!fs.existsSync(resolveFaceFxWrapperPath())) {
      missing.push(`FaceFXWrapper (${resolveFaceFxWrapperPath()})`);
    }
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
  if (champollionReady() && voiceReady()) {
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
