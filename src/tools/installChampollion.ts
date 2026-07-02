import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import Seven from 'node-7z';
import { path7za } from '7zip-bin';
import { request } from 'undici';
import {
  CHAMPOLLION_VERSION,
  champollionInstallDir,
  champollionVersionFilePath,
  defaultChampollionExePath,
  isChampollionInstalled,
  readInstalledChampollionVersion,
} from '../champollionPath';
import { PATHS } from '../paths';
import { log } from '../logger';

const RELEASE_TAG = `v${CHAMPOLLION_VERSION}`;
const DOWNLOAD_URL = `https://github.com/Orvid/Champollion/releases/download/${RELEASE_TAG}/Champollion.v${CHAMPOLLION_VERSION}.zip`;

export type InstallChampollionResult = {
  exePath: string;
  version: string;
  skipped: boolean;
};

const extractZip = (archivePath: string, outDir: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, outDir, {
      $bin: path7za,
      yes: true,
      recursive: true,
    });
    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });

const findFileRecursive = (rootDir: string, fileName: string): string | null => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursive(fullPath, fileName);
      if (nested) return nested;
    } else if (entry.name.toLowerCase() === fileName.toLowerCase()) {
      return fullPath;
    }
  }

  return null;
};

const copyDirectory = (fromDir: string, toDir: string): void => {
  fs.mkdirSync(toDir, { recursive: true });
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
};

const downloadReleaseZip = async (destPath: string): Promise<void> => {
  const response = await request(DOWNLOAD_URL, { maxRedirections: 3 });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Download failed: HTTP ${response.statusCode} for ${DOWNLOAD_URL}`);
  }
  if (!response.body) {
    throw new Error(`Download failed: empty body for ${DOWNLOAD_URL}`);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await pipeline(response.body, createWriteStream(destPath));
};

/**
 * Download and install Champollion into `data/tools/champollion`.
 * Skips when the same version is already present unless `force` is true.
 */
export const installChampollion = async (opts?: {
  force?: boolean;
}): Promise<InstallChampollionResult> => {
  const force = opts?.force === true;
  const exePath = defaultChampollionExePath();
  const installedVersion = readInstalledChampollionVersion();

  if (!force && isChampollionInstalled() && installedVersion === CHAMPOLLION_VERSION) {
    return { exePath, version: CHAMPOLLION_VERSION, skipped: true };
  }

  const installDir = champollionInstallDir();
  const cacheZip = path.join(
    PATHS.dataDir,
    'cache',
    'champollion',
    `Champollion.v${CHAMPOLLION_VERSION}.zip`,
  );
  const extractDir = path.join(installDir, '_extract');

  fs.mkdirSync(path.dirname(cacheZip), { recursive: true });
  if (!fs.existsSync(cacheZip)) {
    await downloadReleaseZip(cacheZip);
  }

  fs.rmSync(installDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  await extractZip(cacheZip, extractDir);

  const discoveredExe = findFileRecursive(extractDir, 'Champollion.exe');
  if (!discoveredExe) {
    throw new Error('Champollion.exe not found in the downloaded archive');
  }

  const payloadDir = path.dirname(discoveredExe);
  fs.mkdirSync(installDir, { recursive: true });
  copyDirectory(payloadDir, installDir);
  fs.rmSync(extractDir, { recursive: true, force: true });

  if (!fs.existsSync(exePath)) {
    throw new Error(`Installation failed: ${exePath} was not created`);
  }

  fs.writeFileSync(champollionVersionFilePath(), `${CHAMPOLLION_VERSION}\n`, 'utf8');

  return { exePath, version: CHAMPOLLION_VERSION, skipped: false };
};

let ensureInstallPromise: Promise<InstallChampollionResult> | null = null;

/**
 * Return a working Champollion executable path, installing the bundled release
 * into `data/tools/champollion` when missing (default path only).
 *
 * When `CHAMPOLLION_PATH` is set, that path must already exist — no auto-download.
 */
export const ensureChampollionInstalled = async (): Promise<string> => {
  const configured = process.env.CHAMPOLLION_PATH?.trim();
  if (configured) {
    if (fs.existsSync(configured)) return configured;
    throw new Error(`CHAMPOLLION_PATH not found: ${configured}`);
  }

  const exePath = defaultChampollionExePath();
  const installedVersion = readInstalledChampollionVersion();
  if (isChampollionInstalled() && installedVersion === CHAMPOLLION_VERSION) {
    return exePath;
  }

  if (!ensureInstallPromise) {
    log.info(`Champollion not found — downloading v${CHAMPOLLION_VERSION}…`);
    ensureInstallPromise = installChampollion().finally(() => {
      ensureInstallPromise = null;
    });
  }

  const result = await ensureInstallPromise;
  return result.exePath;
};
