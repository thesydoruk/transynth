import fs from 'node:fs';
import path from 'node:path';
import { resolveImportPackages } from '../../modImport/packages';
import { resolveModImportExtractRoot } from '../../modStorage/paths';

export type LocalizedVoiceExportEntry = {
  /** Zip/install-relative path with forward slashes (e.g. `Sound/Voice/Mod.esp/00123456_1.fuz`). */
  name: string;
  absPath: string;
};

const normalizeZipPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Collect synthesized localized `.fuz` files from `_localize_{hash}/{lang}/`. */
export const collectLocalizedVoiceFiles = (
  modPath: string,
  targetLang: string,
): LocalizedVoiceExportEntry[] => {
  const extractRoot = resolveModImportExtractRoot(modPath);
  if (!extractRoot) return [];

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
        if (!entry.name.toLowerCase().endsWith('.fuz')) continue;
        files.push({
          name: normalizeZipPath(`${zipPrefix}${relPath}`),
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
