import fs from 'node:fs';
import path from 'node:path';
import { isStringsDirName, parseStringsFileName, SKIP_DIRS } from './constants';
import { collectPluginStems } from './pluginDiscovery';
import type { StringsPackCandidate, StringsPackFile } from './types';

const listOrphanStringsFiles = (stringsDir: string, packRoot: string): StringsPackFile[] => {
  const pluginStems = collectPluginStems(packRoot);
  const files: StringsPackFile[] = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(stringsDir);
  } catch {
    return files;
  }

  for (const fileName of entries) {
    const parsed = parseStringsFileName(fileName);
    if (!parsed) continue;
    if (pluginStems.has(parsed.stem.toLowerCase())) continue;

    files.push({
      filePath: path.join(stringsDir, fileName),
      stem: parsed.stem,
      locale: parsed.locale,
      type: parsed.type,
    });
  }

  files.sort((a, b) => a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }));
  return files;
};

/** Group orphan strings files by plugin stem (case-insensitive key, original casing kept). */
export const groupStringsFilesByStem = (files: StringsPackFile[]): StringsPackFile[][] => {
  const groups = new Map<string, { stem: string; files: StringsPackFile[] }>();

  for (const file of files) {
    const key = file.stem.toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.files.push(file);
    else groups.set(key, { stem: file.stem, files: [file] });
  }

  return [...groups.values()]
    .sort((a, b) => a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' }))
    .map((g) =>
      g.files.sort((a, b) =>
        a.filePath.localeCompare(b.filePath, undefined, { sensitivity: 'base' }),
      ),
    );
};

/**
 * Find orphaned strings groups under `scanDir`.
 *
 * Orphan files in each `strings/` folder are split by stem; every stem group
 * becomes a separate import candidate.
 */
export const discoverStringsPacks = (scanDir: string, recursive = true): StringsPackCandidate[] => {
  const packs: StringsPackCandidate[] = [];
  const seenStringsDirs = new Set<string>();

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (isStringsDirName(entry.name)) {
        const normalized = path.resolve(full);
        if (seenStringsDirs.has(normalized)) continue;
        seenStringsDirs.add(normalized);

        const packRoot = dir;
        const orphanFiles = listOrphanStringsFiles(full, packRoot);
        for (const stemFiles of groupStringsFilesByStem(orphanFiles)) {
          packs.push({
            stem: stemFiles[0]!.stem,
            packRoot,
            stringsDir: full,
            files: stemFiles,
          });
        }
        continue;
      }

      if (recursive) walk(full);
    }
  };

  walk(scanDir);
  packs.sort((a, b) => {
    const byStem = a.stem.localeCompare(b.stem, undefined, { sensitivity: 'base' });
    if (byStem !== 0) return byStem;
    return a.packRoot.localeCompare(b.packRoot, undefined, { sensitivity: 'base' });
  });
  return packs;
};
