import fs from 'node:fs';
import path from 'node:path';

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
    const candidate = suffix ? `${baseStem}${suffix}.ba2` : `${baseStem}.ba2`;
    const p = path.join(dir, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
