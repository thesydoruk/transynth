import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../paths';
import { log } from '../logger';
import {
  resolveFaceFxWrapperPath,
  resolveFonixDataPath,
  resolveFfmpegPath,
  resolveXwmaEncodePath,
  voiceToolsDir,
} from '../voice/voiceToolPaths';
import {
  copyFileSafe,
  downloadFile,
  extractArchive,
  extractZip,
  findFileRecursive,
} from './archiveUtils';
import { discoverGameVoiceAssets, pickFirstGameAsset } from './discoverGameVoiceAssets';

export const FACEFX_WRAPPER_VERSION = '0.41';
const FACEFX_DOWNLOAD_URL = `https://github.com/Nukem9/FaceFXWrapper/releases/download/${FACEFX_WRAPPER_VERSION}/FaceFXWrapper.${FACEFX_WRAPPER_VERSION}.zip`;
const FFMPEG_DOWNLOAD_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
/** Official Microsoft DirectX SDK (June 2010) — xWMAEncode lives inside (~570 MB). */
const DXSDK_JUN10_DOWNLOAD_URL =
  'https://download.microsoft.com/download/A/E/7/AE743F1C-BA16-4A70-B571-8CF6A3388B44/DXSDK_Jun10.exe';
const DXSDK_CACHE_NAME = 'DXSDK_Jun10.exe';

export const voiceToolsVersionFilePath = (): string => path.join(voiceToolsDir(), 'VERSION');

export type InstallVoiceToolsResult = {
  installDir: string;
  faceFxPath: string;
  fonixPath: string;
  xwmaPath: string;
  ffmpegPath: string;
  skipped: boolean;
  warnings: string[];
};

const readVoiceToolsVersion = (): string | null => {
  try {
    return fs.readFileSync(voiceToolsVersionFilePath(), 'utf8').trim() || null;
  } catch {
    return null;
  }
};

const isVoiceToolsInstalled = (): boolean => {
  return (
    fs.existsSync(resolveFaceFxWrapperPath()) &&
    fs.existsSync(resolveFonixDataPath()) &&
    fs.existsSync(resolveXwmaEncodePath()) &&
    voiceFfmpegExists()
  );
};

const voiceFfmpegExists = (): boolean => {
  const bundled = path.join(voiceToolsDir(), 'ffmpeg.exe');
  if (fs.existsSync(bundled)) return true;
  if (process.env.FFMPEG_PATH?.trim()) return fs.existsSync(process.env.FFMPEG_PATH.trim());
  return process.platform !== 'win32';
};

const installFaceFxWrapper = async (installDir: string, force: boolean): Promise<void> => {
  const dest = path.join(installDir, 'FaceFXWrapper.exe');
  if (!force && fs.existsSync(dest)) return;

  const cacheZip = path.join(
    PATHS.dataDir,
    'cache',
    'voice',
    `FaceFXWrapper.${FACEFX_WRAPPER_VERSION}.zip`,
  );
  const extractDir = path.join(PATHS.dataDir, 'cache', 'voice', 'facefx-extract');

  if (!fs.existsSync(cacheZip)) {
    log.info(`Downloading FaceFXWrapper ${FACEFX_WRAPPER_VERSION}…`);
    await downloadFile(FACEFX_DOWNLOAD_URL, cacheZip);
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await extractZip(cacheZip, extractDir);

  const discovered = findFileRecursive(extractDir, 'FaceFXWrapper.exe');
  if (!discovered) {
    throw new Error('FaceFXWrapper.exe not found in the downloaded archive');
  }
  copyFileSafe(discovered, dest);
};

const installFonixData = (
  installDir: string,
  gameDirs: string[],
  force: boolean,
  warnings: string[],
): void => {
  const dest = path.join(installDir, 'FonixData.cdf');
  if (!force && fs.existsSync(dest)) return;

  const { fonixDataPath, root: assetRoot } = pickFirstGameAsset(discoverGameVoiceAssets(gameDirs));
  if (!fonixDataPath) {
    warnings.push(
      'FonixData.cdf not found — install Creation Kit / FO4, set CREATION_KIT_DIR, or set FONIX_DATA_PATH',
    );
    return;
  }

  log.info(`Copying FonixData.cdf from ${fonixDataPath}${assetRoot ? ` (${assetRoot})` : ''}`);
  copyFileSafe(fonixDataPath, dest);
};

const dxsdkCachePath = (): string => path.join(PATHS.dataDir, 'cache', 'voice', DXSDK_CACHE_NAME);

const extractXwmaEncodeFromDxSdkInstaller = async (
  installerPath: string,
  dest: string,
): Promise<boolean> => {
  const extractDir = path.join(PATHS.dataDir, 'cache', 'voice', 'dxsdk-extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  log.info(`Extracting xWMAEncode.exe from ${path.basename(installerPath)} (may take a minute)…`);
  await extractArchive(installerPath, extractDir);
  const discovered = findFileRecursive(extractDir, 'xWMAEncode.exe');
  if (!discovered) return false;
  copyFileSafe(discovered, dest);
  return true;
};

const installXwmaEncode = async (
  installDir: string,
  gameDirs: string[],
  force: boolean,
  warnings: string[],
): Promise<void> => {
  const dest = path.join(installDir, 'xWMAEncode.exe');
  if (!force && fs.existsSync(dest)) return;

  const { xWmaEncodePath } = pickFirstGameAsset(discoverGameVoiceAssets(gameDirs));
  if (xWmaEncodePath) {
    log.info(`Copying xWMAEncode.exe from ${xWmaEncodePath}`);
    copyFileSafe(xWmaEncodePath, dest);
    return;
  }

  const dxsdkInstaller = process.env.DXSDK_JUN10_PATH?.trim();
  if (dxsdkInstaller && fs.existsSync(dxsdkInstaller)) {
    if (await extractXwmaEncodeFromDxSdkInstaller(dxsdkInstaller, dest)) return;
  }

  if (process.platform === 'win32') {
    const cached = dxsdkCachePath();
    if (!fs.existsSync(cached)) {
      log.info(
        'Downloading Microsoft DirectX SDK (June 2010) for xWMAEncode.exe (~570 MB, one-time)…',
      );
      try {
        await downloadFile(DXSDK_JUN10_DOWNLOAD_URL, cached);
      } catch (err) {
        warnings.push(
          `xWMAEncode download failed: ${err instanceof Error ? err.message : String(err)} — set DXSDK_JUN10_PATH or XWMA_ENCODE_PATH`,
        );
        return;
      }
    }
    if (await extractXwmaEncodeFromDxSdkInstaller(cached, dest)) return;
  }

  warnings.push(
    'xWMAEncode.exe not found — install FO4/Skyrim SE tools, set XWMA_ENCODE_PATH, or run on Windows to auto-download the DirectX SDK',
  );
};

const installFfmpeg = async (
  installDir: string,
  force: boolean,
  warnings: string[],
): Promise<void> => {
  const dest = path.join(installDir, 'ffmpeg.exe');
  if (!force && fs.existsSync(dest)) return;

  if (process.env.FFMPEG_PATH?.trim() && fs.existsSync(process.env.FFMPEG_PATH.trim())) {
    return;
  }

  if (process.platform !== 'win32') {
    return;
  }

  const cacheZip = path.join(PATHS.dataDir, 'cache', 'voice', 'ffmpeg-win64-gpl.zip');
  const extractDir = path.join(PATHS.dataDir, 'cache', 'voice', 'ffmpeg-extract');

  try {
    if (!fs.existsSync(cacheZip)) {
      log.info('Downloading ffmpeg (Windows build)…');
      await downloadFile(FFMPEG_DOWNLOAD_URL, cacheZip);
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
    fs.mkdirSync(extractDir, { recursive: true });
    await extractZip(cacheZip, extractDir);

    const discovered = findFileRecursive(extractDir, 'ffmpeg.exe');
    if (!discovered) {
      throw new Error('ffmpeg.exe not found in the downloaded archive');
    }
    copyFileSafe(discovered, dest);
  } catch (err) {
    warnings.push(
      `ffmpeg install failed: ${err instanceof Error ? err.message : String(err)} — install ffmpeg manually or set FFMPEG_PATH`,
    );
  }
};

/**
 * Install voice-localization tooling into `data/tools/voice`.
 * Downloads FaceFXWrapper, ffmpeg, and xWMAEncode (from Microsoft DirectX SDK when needed).
 * Copies FonixData.cdf from a detected game / Creation Kit install.
 */
export const installVoiceTools = async (opts?: {
  force?: boolean;
  gameDirs?: string[];
}): Promise<InstallVoiceToolsResult> => {
  const force = opts?.force === true;
  const gameDirs = opts?.gameDirs ?? [];
  const installDir = voiceToolsDir();
  const warnings: string[] = [];

  if (!force && isVoiceToolsInstalled() && readVoiceToolsVersion() === FACEFX_WRAPPER_VERSION) {
    return {
      installDir,
      faceFxPath: resolveFaceFxWrapperPath(),
      fonixPath: resolveFonixDataPath(),
      xwmaPath: resolveXwmaEncodePath(),
      ffmpegPath: resolveFfmpegPath(),
      skipped: true,
      warnings,
    };
  }

  fs.mkdirSync(installDir, { recursive: true });
  await installFaceFxWrapper(installDir, force);
  installFonixData(installDir, gameDirs, force, warnings);
  await installXwmaEncode(installDir, gameDirs, force, warnings);
  await installFfmpeg(installDir, force, warnings);

  fs.writeFileSync(voiceToolsVersionFilePath(), `${FACEFX_WRAPPER_VERSION}\n`, 'utf8');

  return {
    installDir,
    faceFxPath: resolveFaceFxWrapperPath(),
    fonixPath: resolveFonixDataPath(),
    xwmaPath: resolveXwmaEncodePath(),
    ffmpegPath: resolveFfmpegPath(),
    skipped: false,
    warnings,
  };
};
