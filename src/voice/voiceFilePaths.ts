import path from 'node:path';
import type { VoiceFileEntry } from './discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** Relative path for synthesized localized `.fuz` stored under `localize/`. */
export const outputLocalizedFuzRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.fuz`));
};

/** @deprecated Use {@link outputLocalizedFuzRelPath}. Legacy sidecar from older voice jobs. */
export const outputTtsWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.tts.wav`));
};
