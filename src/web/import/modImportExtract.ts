import path from 'node:path';
import {
  type ModImportExtractManifest,
  writeModImportExtractManifest,
  extractAllBethesdaArchivesInTreeWithManifest,
} from '../../modImport';
import { resolveModImportExtractRoot } from '../../modStorage';

export { resolveModImportExtractRoot } from '../../modStorage';

const normalizeEntryPath = (entryPath: string): string => entryPath.replace(/\\/g, '/');

const containerPackingFromName = (fileName: string): 'zip' | '7z' | 'rar' | null => {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.zip') return 'zip';
  if (ext === '.7z') return '7z';
  if (ext === '.rar') return 'rar';
  return null;
};

/**
 * Directories to scan for companion BA2/BSA archives for one plugin.
 *
 * Uses the full `_extracted_*` tree when present; otherwise the plugin folder
 * and optionally its parent when companion archives live one level up.
 */
export const collectPluginArchiveScopeDirs = (
  pluginPath: string,
  discoverArchiveCandidates: (espPath: string) => string[],
): string[] => {
  const extractedRoot = resolveModImportExtractRoot(pluginPath);
  if (extractedRoot) return [extractedRoot];

  const dirs = new Set<string>();
  const pluginDir = path.dirname(pluginPath);
  dirs.add(pluginDir);

  const parent = path.dirname(pluginDir);
  if (parent !== pluginDir) {
    const candidates = discoverArchiveCandidates(pluginPath);
    if (candidates.some((candidate) => path.dirname(candidate) === parent)) {
      dirs.add(parent);
    }
  }

  return [...dirs];
};

export type BuildModImportExtractManifestOptions = {
  extractRoot: string;
  container?: {
    fileName: string;
    archivePath: string;
  };
  scopeDirs?: string[];
};

/** Extract in-game archives under `extractRoot` and build a provenance manifest. */
export const buildModImportExtractManifest = (
  options: BuildModImportExtractManifestOptions,
): ModImportExtractManifest => {
  const extractRoot = path.resolve(options.extractRoot);
  const scopeDirs = options.scopeDirs ?? [extractRoot];
  const { archives, files } = extractAllBethesdaArchivesInTreeWithManifest(extractRoot, scopeDirs);

  const containerPacking = options.container
    ? containerPackingFromName(options.container.fileName)
    : null;

  return {
    version: 1,
    extractRoot,
    createdAt: new Date().toISOString(),
    container:
      options.container && containerPacking
        ? {
            fileName: options.container.fileName,
            packing: containerPacking,
            relativePath: normalizeEntryPath(
              path.relative(extractRoot, path.resolve(options.container.archivePath)),
            ),
          }
        : undefined,
    archives,
    files,
  };
};

/** Extract BA2/BSA archives and persist `import-manifest.json` under the extract root. */
export const extractGameArchivesForImport = (
  options: BuildModImportExtractManifestOptions,
): ModImportExtractManifest => {
  const manifest = buildModImportExtractManifest(options);
  writeModImportExtractManifest(manifest.extractRoot, manifest);
  return manifest;
};
