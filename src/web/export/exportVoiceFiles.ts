import fs from 'node:fs';
import path from 'node:path';
import { resolveImportPackages } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';

export type LocalizedVoiceExportEntry = {
  /** Zip/install-relative path with forward slashes (e.g. `Sound/Voice/Mod.esp/00123456_1.fuz`). */
  name: string;
  absPath: string;
};

export type CollectLocalizedVoiceOptions = {
  /** File extensions to include (default: `.fuz` only). */
  extensions?: string[];
  /** Rewrite the zip-relative path after the package folder prefix. */
  zipPathTransform?: (relPath: string) => string;
};

const normalizeZipPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const matchesExtension = (fileName: string, extensions: string[]): boolean => {
  const lower = fileName.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext.toLowerCase()));
};

/** Collect synthesized localized voice files from `_localize_{hash}/{lang}/`. */
export const collectLocalizedVoiceFiles = (
  modPath: string,
  targetLang: string,
  options: CollectLocalizedVoiceOptions = {},
): LocalizedVoiceExportEntry[] => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return [];

  const extensions = options.extensions ?? ['.fuz'];
  const packages = resolveImportPackages(extractRoot, targetLang, modPath);
  const files: LocalizedVoiceExportEntry[] = [];

  for (const pkg of packages) {
    if (!fs.existsSync(pkg.localizeDir)) continue;

    const zipPrefix = pkg.folder ? `${pkg.folder}/` : '';
    const walk = (current: string, relDir: string): void => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full, relPath);
          continue;
        }
        if (!matchesExtension(entry.name, extensions)) continue;
        const transformed = options.zipPathTransform
          ? options.zipPathTransform(normalizeZipPath(relPath))
          : normalizeZipPath(`${zipPrefix}${relPath}`);
        files.push({
          name: normalizeZipPath(transformed),
          absPath: full,
        });
      }
    };

    walk(pkg.localizeDir, '');
  }

  files.sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  );
  return files;
};
