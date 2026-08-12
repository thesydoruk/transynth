import path from 'node:path';
import type { VoiceFileEntry } from '../discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Localized `.wav` path under `_localize_{hash}/{lang}/` (mirrors Audio/…). */
export const outputLocalizedWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.wav`));
};
