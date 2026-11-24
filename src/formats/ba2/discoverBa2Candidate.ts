import fs from 'node:fs';
import path from 'node:path';

/**
 * A file in `dir` by name, whatever the case of its letters on disk: the engine
 * and Windows do not tell `Mod - Main.ba2` from `mod - main.ba2`, a Linux host does.
 */
export const findFileIgnoringCase = (dir: string, fileName: string): string | null => {
  const exact = path.join(dir, fileName);
  if (fs.existsSync(exact)) return exact;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const wanted = fileName.toLowerCase();
  const found = names.find((name) => name.toLowerCase() === wanted);
  return found ? path.join(dir, found) : null;
};

/**
 * Find the BA2 that goes with a plugin, by Creation Kit naming convention
 * (`<stem> - Main.ba2`, plus `<stem> - Interface.ba2` on titles that pack into
 * BA2) — first among already-discovered candidates, then on disk next to the
 * plugin.
 */
export const discoverBa2Candidate = (
  modPath: string,
  ba2Candidates: string[],
  archiveKind: 'ba2' | 'bsa' = 'ba2',
): string | null => {
  const stem = path.basename(modPath, path.extname(modPath)).toLowerCase();
  const baseStem = path.basename(modPath, path.extname(modPath));
  const suffixes = archiveKind === 'ba2' ? [' - main', ' - interface', ''] : [' - main', ''];

  for (const suffix of suffixes) {
    const target = suffix ? `${stem}${suffix}` : stem;
    for (const ba2 of ba2Candidates) {
      if (path.basename(ba2, '.ba2').toLowerCase() === target) return ba2;
    }
  }

  const dir = path.dirname(modPath);
  for (const suffix of suffixes) {
    const found = findFileIgnoringCase(dir, `${baseStem}${suffix}.ba2`);
    if (found) return found;
  }
  return null;
};
