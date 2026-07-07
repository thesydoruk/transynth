import fs from 'node:fs';
import path from 'node:path';
import type { GameType } from '../types';

export const MANIFEST_FILE_NAME = 'manifest.json';

export type ArchiveManifestEntry = {
  type: 'ba2' | 'bsa';
  fileName: string;
  entries: string[];
  /** BSA format version (104 = LE, 105 = SE). Only for `type: "bsa"`. */
  bsaVersion?: number;
};

export type ModWorkspacePackage = {
  /** Relative path under `extracted/` (empty string = root). */
  folder: string;
  pluginFiles: string[];
  archives: ArchiveManifestEntry[];
};

export type ModWorkspaceManifest = {
  version: 1;
  game: GameType;
  modName: string;
  packages: ModWorkspacePackage[];
};

export const manifestPath = (workspaceDir: string): string =>
  path.join(workspaceDir, MANIFEST_FILE_NAME);

export const readModWorkspaceManifest = (workspaceDir: string): ModWorkspaceManifest | null => {
  const filePath = manifestPath(workspaceDir);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ModWorkspaceManifest;
};

export const writeModWorkspaceManifest = (
  workspaceDir: string,
  manifest: ModWorkspaceManifest,
): void => {
  fs.writeFileSync(manifestPath(workspaceDir), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
};
