import fs from 'node:fs';
import path from 'node:path';
import {
  CHAMPOLLION_VERSION,
  champollionInstallDir,
  champollionVersionFilePath,
  defaultChampollionExePath,
  isChampollionInstalled,
  readInstalledChampollionVersion,
} from '../champollionPath';
import { PATHS } from '../paths';
import { copyDirectory, downloadFile, extractZip, findFileRecursive } from './archiveUtils';

const RELEASE_TAG = `v${CHAMPOLLION_VERSION}`;
const DOWNLOAD_URL = `https://github.com/Orvid/Champollion/releases/download/${RELEASE_TAG}/Champollion.v${CHAMPOLLION_VERSION}.zip`;

export type InstallChampollionResult = {
  exePath: string;
  version: string;
  skipped: boolean;
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
    await downloadFile(DOWNLOAD_URL, cacheZip);
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
