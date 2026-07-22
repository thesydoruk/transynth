import path from 'node:path';
import type { VoiceFileEntry } from './discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Relative path for synthesized localized `.fuz` stored under `_localize_{hash}/{lang}/`. */
export const outputLocalizedFuzRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.fuz`));
};
