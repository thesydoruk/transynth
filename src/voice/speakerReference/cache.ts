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

/** Cache-safe id of one take: origin keeps two plugins' equal lower-6 apart. */
export const entryReferenceId = (entry: VoiceFileEntry): string =>
  `${entry.originPlugin ? `${entry.originPlugin}_` : ''}${entry.lineKey}_${entry.variant}`;

export const sourceDigest = (sourcePath: string): string => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
};

const readCacheMarker = (markerPath: string): string | null => {
  if (!fs.existsSync(markerPath)) return null;
  return fs.readFileSync(markerPath, 'utf8').trim() || null;
};

/** Per-call suffix: parallel scans of one speaker must never share a temp file. */
const uniqueSuffix = (): string =>
  `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Write through a temp file + rename so a reader never sees a half-written file. */
const writeFileAtomic = (filePath: string, write: (tmpPath: string) => void): void => {
  const tmpPath = `${filePath}.${uniqueSuffix()}.tmp`;
  try {
    write(tmpPath);
    fs.renameSync(tmpPath, filePath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
};

const writeCacheMarker = (markerPath: string, marker: string): void => {
  writeFileAtomic(markerPath, (tmpPath) => fs.writeFileSync(tmpPath, marker));
};

/** Reuse a cached decoded reference WAV for one voice line when the source file is unchanged. */
export const getOrDecodeEntryReferenceWav = async (
  entry: VoiceFileEntry,
  entryCacheDir: string,
  workDir: string,
): Promise<string> => {
  const base = entryReferenceId(entry);
  const outPath = path.join(entryCacheDir, `${base}.wav`);
  const markerPath = path.join(entryCacheDir, `${base}.source`);
  const digest = sourceDigest(entry.absolutePath);
  if (readCacheMarker(markerPath) === digest && isUsableWavFile(outPath)) {
    return outPath;
  }

  ensureDir(entryCacheDir);
  // Decode beside the target and rename into place: parallel lines of one
  // speaker decode the same takes, and a half-written WAV must never be read
  // (or cached) as the finished one.
  const tmpPath = path.join(entryCacheDir, `${base}.${uniqueSuffix()}.tmp.wav`);
  try {
    await decodeEntryToReferenceWav(entry, tmpPath, workDir);
    if (!isUsableWavFile(tmpPath)) {
      throw new Error(`Decoded reference audio has no audio data: ${entry.relPath}`);
    }
    fs.renameSync(tmpPath, outPath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
  writeCacheMarker(markerPath, digest);
  return outPath;
};

/** Cached reference WAV plus its marker file for one speaker. */
const speakerReferenceCacheFiles = (
  speakerKey: string,
  speakerCacheDir: string,
): { wavPath: string; markerPath: string } => {
  const safeKey = speakerKey.replace(/[^\w.-]+/g, '_');
  return {
    wavPath: path.join(speakerCacheDir, `${safeKey}.wav`),
    markerPath: path.join(speakerCacheDir, `${safeKey}.source`),
  };
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
  writeFileAtomic(outPath, (tmpPath) => fs.copyFileSync(decodedPath, tmpPath));
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

  if (entry.ext === 'fuz') {
    const xwmPath = path.join(
      tempDir,
      `${entryReferenceId(entry)}.${uniqueSuffix()}.src.audio.xwm`,
    );
    try {
      fs.writeFileSync(xwmPath, extractXwmFromFuzFile(entry.absolutePath));
      await decodeAudioToReferenceWav(xwmPath, outputPath);
    } finally {
      fs.rmSync(xwmPath, { force: true });
    }
    return;
  }

  await decodeAudioToReferenceWav(entry.absolutePath, outputPath);
};
