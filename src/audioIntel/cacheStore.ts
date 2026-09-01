import fs from 'node:fs';
import path from 'node:path';
import { sha1Hex } from '../utils/hash';
import { transcribeWav, type TranscribeWavOptions } from './client';
import type { AudioIntelTranscript } from './types';

export type AudioIntelCacheRecord = {
  wavPath: string;
  size: number;
  mtimeMs: number;
  transcript: AudioIntelTranscript;
};

export const audioIntelCacheKey = (wavPath: string): string => {
  const resolved = path.resolve(wavPath);
  const stat = fs.statSync(resolved);
  return sha1Hex(`${resolved}|${stat.mtimeMs}|${stat.size}`);
};

const cacheFileFor = (cacheDir: string, wavPath: string): string =>
  path.join(cacheDir, `${audioIntelCacheKey(wavPath)}.json`);

export const readAudioIntelCacheAt = (
  cacheDir: string,
  wavPath: string,
): AudioIntelTranscript | null => {
  const file = cacheFileFor(cacheDir, wavPath);
  if (!fs.existsSync(file)) return null;
  try {
    const row = JSON.parse(fs.readFileSync(file, 'utf8')) as AudioIntelCacheRecord;
    return row.transcript ?? null;
  } catch {
    return null;
  }
};

export const writeAudioIntelCacheAt = (
  cacheDir: string,
  wavPath: string,
  transcript: AudioIntelTranscript,
): void => {
  const resolved = path.resolve(wavPath);
  const stat = fs.statSync(resolved);
  fs.mkdirSync(cacheDir, { recursive: true });
  const record: AudioIntelCacheRecord = {
    wavPath: resolved,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    transcript,
  };
  fs.writeFileSync(cacheFileFor(cacheDir, wavPath), `${JSON.stringify(record)}\n`, 'utf8');
};

/** Cached transcribe against an explicit cache directory (tests; no PATHS import). */
export const transcribeWavCachedAt = async (
  cacheDir: string,
  wavPath: string,
  options: TranscribeWavOptions = {},
): Promise<AudioIntelTranscript> => {
  const cached = readAudioIntelCacheAt(cacheDir, wavPath);
  if (cached) return cached;
  const transcript = await transcribeWav(wavPath, options);
  writeAudioIntelCacheAt(cacheDir, wavPath, transcript);
  return transcript;
};
