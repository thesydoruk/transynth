import path from 'node:path';
import type { VoiceFileEntry } from './discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

export const outputFuzRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.fuz`));
};

export const outputTtsWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.tts.wav`));
};

export const outputRefWavRelPath = (entry: VoiceFileEntry): string => {
  const base = entry.fileName.replace(/\.(fuz|wav|xwm)$/i, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${base}.ref.wav`));
};
