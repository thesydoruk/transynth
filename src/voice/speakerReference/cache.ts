import fs from 'node:fs';
import path from 'node:path';
import { sha1Hex } from '../../utils/hash';
import { ensureDir } from '../../utils/file';
import { decodeAudioToReferenceWav } from '../ffmpegAudio';
import { extractXwmFromFuzFile } from '../../formats/fuz';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { MIN_REFERENCE_DURATION_SEC } from './constants';
import { isUsableWavFile, wavDurationSec } from './pcm';

/**
 * A speaker reference stays cached across runs, so a clip picked under an older
 * (shorter) duration floor would keep failing every line of that speaker. Check
 * the current floor on reuse instead of trusting the cache marker alone.
 */
const isReusableSpeakerReference = (wavPath: string): boolean =>
  isUsableWavFile(wavPath) && wavDurationSec(wavPath) >= MIN_REFERENCE_DURATION_SEC;

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
  if (readCacheMarker(markerPath) === digest && isUsableWavFile(outPath)) {
    return outPath;
  }

  ensureDir(entryCacheDir);
  await decodeEntryToReferenceWav(entry, outPath, workDir);
  if (!isUsableWavFile(outPath)) {
    fs.rmSync(outPath, { force: true });
    throw new Error(`Decoded reference audio has no audio data: ${entry.relPath}`);
  }
  writeCacheMarker(markerPath, digest);
  return outPath;
};

/** Cached reference WAV plus its marker file for one speaker. */
export const speakerReferenceCacheFiles = (
  speakerKey: string,
  speakerCacheDir: string,
): { wavPath: string; markerPath: string } => {
  const safeKey = speakerKey.replace(/[^\w.-]+/g, '_');
  return {
    wavPath: path.join(speakerCacheDir, `${safeKey}.wav`),
    markerPath: path.join(speakerCacheDir, `${safeKey}.source`),
  };
};

/** Drop a speaker's cached reference WAV so the next resolve re-decodes it. */
export const clearCachedSpeakerReference = (speakerKey: string, speakerCacheDir: string): void => {
  const { wavPath, markerPath } = speakerReferenceCacheFiles(speakerKey, speakerCacheDir);
  fs.rmSync(wavPath, { force: true });
  fs.rmSync(markerPath, { force: true });
};

export const getOrReuseSpeakerReferenceWav = async (
  speakerKey: string,
  speakerCacheDir: string,
  marker: string,
  produceWav: () => Promise<string>,
): Promise<string> => {
  const { wavPath: outPath, markerPath } = speakerReferenceCacheFiles(speakerKey, speakerCacheDir);
  if (readCacheMarker(markerPath) === marker && isReusableSpeakerReference(outPath)) {
    return outPath;
  }

  const decodedPath = await produceWav();
  if (!isUsableWavFile(decodedPath)) {
    throw new Error(`Speaker reference has no audio data: ${decodedPath}`);
  }
  const durationSec = wavDurationSec(decodedPath);
  if (durationSec < MIN_REFERENCE_DURATION_SEC) {
    throw new Error(
      `Speaker reference too short (${durationSec.toFixed(2)}s < ${MIN_REFERENCE_DURATION_SEC}s): ${decodedPath}`,
    );
  }
  ensureDir(speakerCacheDir);
  fs.copyFileSync(decodedPath, outPath);
  writeCacheMarker(markerPath, marker);
  return outPath;
};

export const tryCachedSpeakerReference = (
  speakerKey: string,
  speakerCacheDir: string,
): string | null => {
  const { wavPath, markerPath } = speakerReferenceCacheFiles(speakerKey, speakerCacheDir);
  if (!readCacheMarker(markerPath) || !isReusableSpeakerReference(wavPath)) return null;
  return wavPath;
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
