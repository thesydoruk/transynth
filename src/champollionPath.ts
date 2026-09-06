import fs from 'node:fs';

/** Native ELF compiled into the Docker image from thesydoruk/linux-champollion. */
export const IMAGE_CHAMPOLLION_PATH = '/usr/local/bin/Champollion';

export const resolveChampollionPath = (): string => IMAGE_CHAMPOLLION_PATH;

export const requireChampollionPath = (): string => {
  const resolved = resolveChampollionPath();
  if (!fs.existsSync(resolved)) {
    throw new Error(`Champollion not found at ${resolved}. Rebuild the Docker image.`);
  }
  return resolved;
};

/** Resolves the native binary; does not download anything. */
export const ensureChampollionInstalled = async (): Promise<string> => requireChampollionPath();
