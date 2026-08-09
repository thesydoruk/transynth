import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../../../paths';
import { log } from '../../../logger';

const LIBRARY_SOURCES = ['common_voice', 'opentts'] as const;

/**
 * Delete WAV files under uk-voice-library that are not referenced by keepRelPaths.
 * Used after import drops obsolete DB rows (old cv_<rowIdx>.wav leftovers).
 */
export const pruneOrphanUkVoiceLibraryFiles = (keepRelPaths: Iterable<string>): number => {
  const keep = new Set([...keepRelPaths].map((rel) => rel.replace(/\\/g, '/').replace(/^\/+/, '')));
  let removed = 0;
  for (const source of LIBRARY_SOURCES) {
    const dir = path.join(PATHS.ukVoiceLibrary, source);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (!fs.statSync(abs).isFile()) continue;
      const rel = `${source}/${name}`;
      if (keep.has(rel)) continue;
      fs.unlinkSync(abs);
      removed += 1;
    }
  }
  if (removed > 0) {
    log.info(`uk-voice-library: pruned ${removed} orphan audio file(s)`);
  }
  return removed;
};
