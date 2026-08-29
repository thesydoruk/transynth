/**
 * Read a mod's own `Interface/` assets, wherever the mod keeps them.
 *
 * A mod ships interface files either loose next to the plugin or packed into its
 * general-purpose BA2, and export has to find them in both places: `Translate_*.txt`
 * to merge translations into, and `fonts_*.swf` to repair glyphs in.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getBa2Reader, isBa2GnrArchive } from '../../formats/ba2';
import { resolveModDirectoryFromPath } from '../../formats/mcm';
import { listCompanionGnrlBa2ForPlugin } from '../../import/mod/discovery';
import type { GameType } from '../../types';

/**
 * Read one file from the mod's `Interface/` folder.
 *
 * @param modPath - Path to the mod's plugin file.
 * @param fileName - File name inside `Interface/`, e.g. `fonts_en.swf`.
 * @param game - Game the mod targets, used to locate companion archives.
 * @returns File contents, or `null` when the mod does not ship it.
 */
export const readModInterfaceFile = (
  modPath: string,
  fileName: string,
  game: GameType,
): Buffer | null => {
  const modDir = resolveModDirectoryFromPath(modPath);
  const loosePath = path.join(modDir, 'Interface', fileName);
  if (fs.existsSync(loosePath)) return fs.readFileSync(loosePath);

  const ext = path.extname(fileName).replace(/^\./, '');
  const suffix = `/${fileName.toLowerCase()}`;

  for (const ba2Path of listCompanionGnrlBa2ForPlugin(modPath, game)) {
    if (!isBa2GnrArchive(ba2Path)) continue;
    try {
      const reader = getBa2Reader(ba2Path);
      const entry = reader.listByExt(ext).find((item) => {
        const name = item.name.replace(/\\/g, '/').toLowerCase();
        return name === fileName.toLowerCase() || name.endsWith(suffix);
      });
      if (entry) return reader.extractEntry(entry);
    } catch {
      // Try the next archive.
    }
  }

  return null;
};
