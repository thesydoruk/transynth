import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths';

/** Bundled Champollion release installed by `npm run tools:champollion`. */
export const CHAMPOLLION_VERSION = '1.3.2';

export const champollionInstallDir = (): string => PATHS.champollion;

export const defaultChampollionExePath = (): string =>
  path.join(champollionInstallDir(), 'Champollion.exe');

export const champollionVersionFilePath = (): string =>
  path.join(champollionInstallDir(), 'VERSION');

/** Env override, otherwise `data/tools/champollion/Champollion.exe`. */
export const resolveChampollionPath = (): string => {
  const configured = process.env.CHAMPOLLION_PATH?.trim();
  if (configured) return configured;
  return defaultChampollionExePath();
};

export const isChampollionInstalled = (): boolean => fs.existsSync(resolveChampollionPath());

export const readInstalledChampollionVersion = (): string | null => {
  try {
    return fs.readFileSync(champollionVersionFilePath(), 'utf8').trim() || null;
  } catch {
    return null;
  }
};
