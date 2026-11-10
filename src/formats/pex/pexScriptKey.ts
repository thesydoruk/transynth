/**
 * Where a compiled script lives and what it is called.
 *
 * The game finds `SimSettlementsV2:Quests:SS2Main` at
 * `Scripts/SimSettlementsV2/Quests/SS2Main.pex`, so the folders under `Scripts/`
 * are the script's namespace. A script at the top of `Scripts/` keeps its bare
 * name, which is what every PEX row was keyed by before namespaces were read.
 */
import fs from 'node:fs';
import path from 'node:path';

export type LoosePexFile = {
  absPath: string;
  /** Path under the mod folder with the folder case on disk, e.g. `Scripts\\A\\B.pex`. */
  archivePath: string;
};

const splitPath = (value: string): string[] => value.replace(/\\/g, '/').split('/').filter(Boolean);

/** Last segment of a namespaced key: `A:B:Name` → `Name`. */
export const pexScriptBaseName = (scriptKey: string): string =>
  scriptKey.split(':').pop() ?? scriptKey;

/**
 * Script key from an archive entry or a path under the mod folder:
 * `Scripts/A/B/Name.pex` → `A:B:Name`, `Scripts/Name.pex` → `Name`.
 *
 * `headerName` (the script name in the PEX header) wins for the last segment
 * when it differs only in case, so a top-level script keeps the key it had.
 */
export const pexScriptKeyFromRelPath = (relPath: string, headerName?: string): string | null => {
  const parts = splitPath(relPath);
  const scriptsAt = parts.findIndex((part) => part.toLowerCase() === 'scripts');
  const inner = scriptsAt === -1 ? parts.slice(-1) : parts.slice(scriptsAt + 1);
  const file = inner.pop();
  if (!file || !/\.pex$/i.test(file)) return null;
  const stem = file.replace(/\.pex$/i, '');
  const name = headerName && headerName.toLowerCase() === stem.toLowerCase() ? headerName : stem;
  return [...inner, name].join(':');
};

const listPexUnder = (dir: string, out: string[]): void => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listPexUnder(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pex')) out.push(full);
  }
};

/**
 * Every loose `.pex` under the mod folder's `Scripts` directory, at any depth and
 * in any letter case of `Scripts` (an unpacked archive may write `SCRIPTS/`).
 */
export const listLoosePexFiles = (modDir: string): LoosePexFile[] => {
  let roots: string[];
  try {
    roots = fs
      .readdirSync(modDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'scripts')
      .map((entry) => path.join(modDir, entry.name))
      .sort();
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const root of roots) listPexUnder(root, files);
  return files.map((absPath) => ({
    absPath,
    archivePath: path.relative(modDir, absPath).split(path.sep).join('\\'),
  }));
};
