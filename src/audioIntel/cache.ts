import { PATHS } from '../paths';
import { readAudioIntelCacheAt, transcribeWavCachedAt, writeAudioIntelCacheAt } from './cacheStore';
import type { TranscribeWavOptions } from './client';
import type { AudioIntelTranscript } from './types';

const cacheDir = (): string => {
  const explicit = process.env.AUDIO_INTEL_CACHE_DIR?.trim();
  return explicit || PATHS.audioIntel;
};

export const readAudioIntelCache = (wavPath: string): AudioIntelTranscript | null =>
  readAudioIntelCacheAt(cacheDir(), wavPath);

export const writeAudioIntelCache = (wavPath: string, transcript: AudioIntelTranscript): void =>
  writeAudioIntelCacheAt(cacheDir(), wavPath, transcript);

/** Cached transcribe — skip HTTP when path+mtime+size already has a transcript. */
export const transcribeWavCached = (
  wavPath: string,
  options: TranscribeWavOptions = {},
): Promise<AudioIntelTranscript> => transcribeWavCachedAt(cacheDir(), wavPath, options);
