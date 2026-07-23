import fs from 'node:fs';
import path from 'node:path';
import { sha1Hex } from '../../utils/hash';
import { ensureDir } from '../../utils/file';
import { decodeAudioToReferenceWav } from '../ffmpegAudio';
import { extractXwmFromFuzFile } from '../../formats/fuz';
import type { VoiceFileEntry } from '../discoverVoiceFiles';

export const sourceDigest = (sourcePath: string): string => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
};

export const readCacheMarker = (markerPath: string): string | null => {
  if (!fs.existsSync(markerPath)) return null;
  return fs.readFileSync(markerPath, 'utf8').trim() || null;
};

export const writeCacheMarker = (markerPath: string, marker: string): void => {
  fs.writeFileSync(markerPath, marker);
};

/** Reuse a cached decoded reference WAV for one voice line when the source file is unchanged. */
export const getOrDecodeEntryReferenceWav = async (
  entry: VoiceFileEntry,
  entryCacheDir: string,
  workDir: string,
): Promise<string> => {
  const base = `${entry.formidLower6}_${entry.variant}`;
  const outPath = path.join(entryCacheDir, `${base}.wav`);
  const markerPath = path.join(entryCacheDir, `${base}.source`);
  const digest = sourceDigest(entry.absolutePath);
  if (fs.existsSync(outPath) && readCacheMarker(markerPath) === digest) {
    return outPath;
  }

  ensureDir(entryCacheDir);
  await decodeEntryToReferenceWav(entry, outPath, workDir);
  writeCacheMarker(markerPath, digest);
  return outPath;
};

export const getOrReuseSpeakerReferenceWav = async (
  speakerKey: string,
  speakerCacheDir: string,
  marker: string,
  produceWav: () => Promise<string>,
): Promise<string> => {
  const safeKey = speakerKey.replace(/[^\w.-]+/g, '_');
  const outPath = path.join(speakerCacheDir, `${safeKey}.wav`);
  const markerPath = path.join(speakerCacheDir, `${safeKey}.source`);
  if (fs.existsSync(outPath) && readCacheMarker(markerPath) === marker) {
    return outPath;
  }

  const decodedPath = await produceWav();
  ensureDir(speakerCacheDir);
  fs.copyFileSync(decodedPath, outPath);
  writeCacheMarker(markerPath, marker);
  return outPath;
};

export const tryCachedSpeakerReference = (
  speakerKey: string,
  speakerCacheDir: string,
): string | null => {
  const safeKey = speakerKey.replace(/[^\w.-]+/g, '_');
  const outPath = path.join(speakerCacheDir, `${safeKey}.wav`);
  const markerPath = path.join(speakerCacheDir, `${safeKey}.source`);
  if (!fs.existsSync(outPath) || !readCacheMarker(markerPath)) return null;
  return outPath;
};

const decodeEntryToReferenceWav = async (
  entry: VoiceFileEntry,
  outputPath: string,
  tempDir: string,
): Promise<void> => {
  if (entry.ext === 'wav') {
    await decodeAudioToReferenceWav(entry.absolutePath, outputPath);
    return;
  }

  const sourceAudioPath = path.join(tempDir, `${entry.formidLower6}_${entry.variant}.src.audio`);
  if (entry.ext === 'fuz') {
    const xwm = extractXwmFromFuzFile(entry.absolutePath);
    fs.writeFileSync(`${sourceAudioPath}.xwm`, xwm);
    await decodeAudioToReferenceWav(`${sourceAudioPath}.xwm`, outputPath);
    return;
  }

  await decodeAudioToReferenceWav(entry.absolutePath, outputPath);
};
