import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE_NAME = 'import-manifest.json';
export const MOD_IMPORT_MANIFEST_FILE_NAME = 'import-manifest.json';

/** Container / in-game archive packing formats tracked during mod import. */
export type ArchivePackingKind = 'zip' | '7z' | 'rar' | 'ba2' | 'bsa';

export type ArchiveManifestEntry = {
  type: 'ba2' | 'bsa';
  fileName: string;
  entries: string[];
  /** BSA format version (104 = LE, 105 = SE). Only for `type: "bsa"`. */
  bsaVersion?: number;
};

/** One BA2/BSA archive extracted during mod import. */
export type ModImportArchiveRecord = {
  fileName: string;
  /** Path relative to the import extract root where the archive lived. */
  relativePath: string;
  packing: 'ba2' | 'bsa';
  extracted: boolean;
  skipReason?: string;
  entries: string[];
  bsaVersion?: number;
  ba2Type?: string | null;
};

/** Provenance for one loose file produced by archive extraction. */
export type ModImportFileProvenance = {
  sourceArchiveRelativePath: string;
  entryPath: string;
  packing: ArchivePackingKind;
};

/** Full extraction manifest for a mod import upload. */
export type ModImportExtractManifest = {
  version: 1;
  /** Absolute path to the extract root on disk. */
  extractRoot: string;
  createdAt: string;
  /** Outer upload container when the user uploaded zip/7z/rar. */
  container?: {
    fileName: string;
    packing: 'zip' | '7z' | 'rar';
    relativePath: string;
  };
  archives: ModImportArchiveRecord[];
  /** Loose file path (relative to extract root, forward slashes) → provenance. */
  files: Record<string, ModImportFileProvenance>;
};

export const modImportManifestPath = (extractRoot: string): string =>
  path.join(extractRoot, MOD_IMPORT_MANIFEST_FILE_NAME);

export const readModImportExtractManifest = (
  extractRoot: string,
): ModImportExtractManifest | null => {
  const filePath = modImportManifestPath(extractRoot);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ModImportExtractManifest;
};

export const writeModImportExtractManifest = (
  extractRoot: string,
  manifest: ModImportExtractManifest,
): void => {
  fs.writeFileSync(
    modImportManifestPath(extractRoot),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
};
