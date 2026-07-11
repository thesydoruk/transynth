import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import { PATHS } from '../paths';
import { sha1Hex } from '../utils/hash';
import { ensureDir } from '../utils/file';
import { decodeAudioToReferenceWav } from '../voice/ffmpegAudio';
import { extractXwmFromFuzFile } from '../formats/fuz';
import { resolveVoiceRootRel, type VoiceFileEntry } from './discoverVoiceFiles';
import {
  loadVoiceSpeakerRef,
  setVoiceSpeakerRef,
  type VoiceSpeakerRefPick,
} from './voiceSpeakerRefs';

const MANUAL_REFERENCE_NAME = '_reference.wav';

/** Stop auto-select after the first clip scoring at or above this (lazy search). */
export const AUTO_SELECT_GOOD_ENOUGH_SCORE = 5;

export const speakerReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'speaker-ref');

const entryReferenceCacheRoot = (modId: number): string =>
  path.join(PATHS.voicePreview, String(modId), 'entry-ref');

const sourceDigest = (sourcePath: string): string => {
  const stat = fs.statSync(sourcePath);
  return sha1Hex(`${sourcePath}|${stat.mtimeMs}|${stat.size}`);
};

const readCacheMarker = (markerPath: string): string | null => {
  if (!fs.existsSync(markerPath)) return null;
  return fs.readFileSync(markerPath, 'utf8').trim() || null;
};

const writeCacheMarker = (markerPath: string, marker: string): void => {
  fs.writeFileSync(markerPath, marker);
};

/** Reuse a cached decoded reference WAV for one voice line when the source file is unchanged. */
const getOrDecodeEntryReferenceWav = async (
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

const getOrReuseSpeakerReferenceWav = async (
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

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

/** NPC voice folder under `Sound/Voice/<plugin>/` (e.g. `AlexanderBrown`). */
export const voiceSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string => {
  const rel = normalizeRelPath(entry.relPath);
  const prefix = `${normalizeRelPath(voiceRootRel)}/`;
  if (!rel.startsWith(prefix)) return '';
  const rest = rel.slice(prefix.length);
  const slash = rest.indexOf('/');
  return slash >= 0 ? rest.slice(0, slash) : '';
};

export type ReferencePcm = {
  samples: Int16Array;
  sampleRate: number;
};

/** Read mono PCM from a standard 16-bit WAV file. */
export const readPcmFromWav = (wavPath: string): ReferencePcm => {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`Not a WAV file: ${wavPath}`);
  }

  let offset = 12;
  let sampleRate = 22_050;
  let bitsPerSample = 16;
  let channels = 1;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === 'fmt ') {
      channels = buf.readUInt16LE(chunkStart + 2);
      sampleRate = buf.readUInt32LE(chunkStart + 4);
      bitsPerSample = buf.readUInt16LE(chunkStart + 14);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      break;
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV format: ${wavPath}`);
  }

  const bytesPerSample = (bitsPerSample / 8) * channels;
  const sampleCount = Math.floor(dataSize / bytesPerSample);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * bytesPerSample);
  }
  return { samples, sampleRate };
};

const scoreDuration = (durationSec: number): number => {
  if (durationSec < 1 || durationSec > 14) return 0;
  const peak = 5;
  const spread = 2.5;
  return Math.exp(-((durationSec - peak) ** 2) / (2 * spread ** 2));
};

type AnalysisFrame = {
  rms: number;
  zcr: number;
};

const analyzeFrames = (samples: Int16Array, sampleRate: number): AnalysisFrame[] => {
  const frameSamples = Math.max(1, Math.floor(sampleRate * 0.025));
  const frames: AnalysisFrame[] = [];

  for (let i = 0; i < samples.length; i += frameSamples) {
    const end = Math.min(i + frameSamples, samples.length);
    let sumSq = 0;
    let crossings = 0;
    let prev = samples[i] ?? 0;
    for (let j = i; j < end; j++) {
      const s = samples[j]!;
      sumSq += s * s;
      if (j > i && ((prev >= 0 && s < 0) || (prev < 0 && s >= 0))) crossings += 1;
      prev = s;
    }
    const len = end - i;
    frames.push({ rms: Math.sqrt(sumSq / len), zcr: crossings / len });
  }

  return frames;
};

/** Penalize long sustained-vowel segments (e.g. "aaaa", "eeee") in active speech. */
export const computeHesitationPenalty = (
  frames: AnalysisFrame[],
  silenceThreshold = 800,
): number => {
  const minRun = 8; // ~200 ms at 25 ms frames
  let run = 0;
  let maxRun = 0;
  let penalty = 0;

  for (const frame of frames) {
    const sustained = frame.rms > silenceThreshold && frame.zcr < 0.04 && frame.rms < 24_000;
    if (sustained) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else {
      if (run >= minRun) penalty += run - minRun + 1;
      run = 0;
    }
  }
  if (run >= minRun) penalty += run - minRun + 1;

  return penalty / Math.max(frames.length, 1) + maxRun * 0.05;
};

/**
 * Higher is better. Returns `-Infinity` for clips unsuitable as XTTS references.
 * Exported for unit tests.
 */
export const scoreReferencePcm = (samples: Int16Array, sampleRate: number): number => {
  if (samples.length === 0) return Number.NEGATIVE_INFINITY;

  const durationSec = samples.length / sampleRate;
  if (durationSec < 0.8 || durationSec > 14) return Number.NEGATIVE_INFINITY;

  const frames = analyzeFrames(samples, sampleRate);
  if (frames.length === 0) return Number.NEGATIVE_INFINITY;

  const silenceThreshold = 800;
  const activeFrames = frames.filter((f) => f.rms > silenceThreshold);
  const activityRatio = activeFrames.length / frames.length;
  if (activityRatio < 0.35) return Number.NEGATIVE_INFINITY;

  const meanRms = frames.reduce((sum, f) => sum + f.rms, 0) / frames.length;
  if (meanRms < 500) return Number.NEGATIVE_INFINITY;

  const clipRatio = frames.filter((f) => f.rms > 28_000).length / frames.length;
  const hesitationPenalty = computeHesitationPenalty(frames, silenceThreshold);
  const durationScore = scoreDuration(durationSec);
  const activityScore = Math.min(1, activityRatio / 0.75);

  return (
    durationScore * 40 +
    activityScore * 30 +
    Math.log10(meanRms) * 5 -
    hesitationPenalty * 25 -
    clipRatio * 20
  );
};

export const scoreReferenceWav = (wavPath: string): number => {
  const { samples, sampleRate } = readPcmFromWav(wavPath);
  return scoreReferencePcm(samples, sampleRate);
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

/** Group voice files by NPC folder name under the plugin voice root. */
export const groupVoiceFilesBySpeaker = (
  entries: VoiceFileEntry[],
  voiceRootRel: string,
): Map<string, VoiceFileEntry[]> => {
  const bySpeaker = new Map<string, VoiceFileEntry[]>();
  for (const entry of entries) {
    const speaker = voiceSpeakerKey(entry, voiceRootRel);
    if (!speaker) continue;
    const list = bySpeaker.get(speaker) ?? [];
    list.push(entry);
    bySpeaker.set(speaker, list);
  }
  return bySpeaker;
};

export type ResolvedSpeakerReference = {
  wavPath: string;
  pick: VoiceSpeakerRefPick;
  source: 'manual' | 'saved' | 'auto';
  score?: number;
};

const findPickedEntry = (
  pick: VoiceSpeakerRefPick,
  preferredEntry: VoiceFileEntry,
  getFallbackEntries: () => VoiceFileEntry[],
): VoiceFileEntry | undefined => {
  if (
    pick.formidLower6.toUpperCase() === preferredEntry.formidLower6.toUpperCase() &&
    pick.variant === preferredEntry.variant
  ) {
    return preferredEntry;
  }
  return getFallbackEntries().find(
    (entry) =>
      entry.formidLower6.toUpperCase() === pick.formidLower6.toUpperCase() &&
      entry.variant === pick.variant,
  );
};

const tryCachedSpeakerReference = (speakerKey: string, speakerCacheDir: string): string | null => {
  const safeKey = speakerKey.replace(/[^\w.-]+/g, '_');
  const outPath = path.join(speakerCacheDir, `${safeKey}.wav`);
  const markerPath = path.join(speakerCacheDir, `${safeKey}.source`);
  if (!fs.existsSync(outPath) || !readCacheMarker(markerPath)) return null;
  return outPath;
};

type ScoredEntry = {
  entry: VoiceFileEntry;
  wavPath: string;
  score: number;
};

const scoreEntryReference = async (
  entry: VoiceFileEntry,
  entryCacheDir: string,
  workDir: string,
): Promise<ScoredEntry | null> => {
  try {
    const wavPath = await getOrDecodeEntryReferenceWav(entry, entryCacheDir, workDir);
    const score = scoreReferenceWav(wavPath);
    return { entry, wavPath, score };
  } catch (err) {
    log.warn(
      `Speaker ref skip ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
};

const finalizeAutoReference = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  speakerCacheDir: string,
  scored: ScoredEntry,
): Promise<ResolvedSpeakerReference> => {
  const pick: VoiceSpeakerRefPick = {
    formidLower6: scored.entry.formidLower6,
    variant: scored.entry.variant,
  };
  await setVoiceSpeakerRef(db, modId, speakerKey, pick, scored.score);

  const autoMarker = `auto:${scored.entry.formidLower6}_${scored.entry.variant}:${sourceDigest(scored.entry.absolutePath)}`;
  const outPath = await getOrReuseSpeakerReferenceWav(
    speakerKey,
    speakerCacheDir,
    autoMarker,
    async () => scored.wavPath,
  );

  log.info(
    `Speaker ref "${speakerKey}": auto ${scored.entry.fileName} (score=${scored.score.toFixed(1)})`,
  );
  return { wavPath: outPath, pick, source: 'auto', score: scored.score };
};

/**
 * Resolve one speaker's XTTS reference clip when synthesizing a voice line.
 * Uses cache / saved DB pick / manual override when available.
 * Auto-select tries `preferredEntry` first and only scans sibling lines on demand.
 */
export const resolveSpeakerReferenceForSpeaker = async (
  db: Tx,
  modId: number,
  speakerKey: string,
  preferredEntry: VoiceFileEntry,
  getFallbackEntries: () => VoiceFileEntry[],
  packageDir: string,
  pluginRelPath: string,
): Promise<ResolvedSpeakerReference | null> => {
  const voiceRootRel = resolveVoiceRootRel(pluginRelPath);
  const voiceRootAbs = path.join(packageDir, ...voiceRootRel.split('/'));
  const speakerCacheDir = speakerReferenceCacheRoot(modId);
  const entryCacheDir = entryReferenceCacheRoot(modId);
  const workDir = path.join(speakerCacheDir, '.work', speakerKey.replace(/[^\w.-]+/g, '_'));
  ensureDir(workDir);

  const cachedWav = tryCachedSpeakerReference(speakerKey, speakerCacheDir);
  if (cachedWav) {
    const cachedPick = await loadVoiceSpeakerRef(db, modId, speakerKey);
    log.debug(`Speaker ref "${speakerKey}": cache hit`);
    return {
      wavPath: cachedWav,
      pick: cachedPick ?? {
        formidLower6: preferredEntry.formidLower6,
        variant: preferredEntry.variant,
      },
      source: cachedPick ? 'saved' : 'auto',
    };
  }

  const manualPath = path.join(voiceRootAbs, speakerKey, MANUAL_REFERENCE_NAME);
  if (fs.existsSync(manualPath)) {
    const manualMarker = `manual:${sourceDigest(manualPath)}`;
    const outPath = await getOrReuseSpeakerReferenceWav(
      speakerKey,
      speakerCacheDir,
      manualMarker,
      async () => {
        const decodedPath = path.join(workDir, MANUAL_REFERENCE_NAME);
        await decodeAudioToReferenceWav(manualPath, decodedPath);
        return decodedPath;
      },
    );
    log.info(`Speaker ref "${speakerKey}": manual ${MANUAL_REFERENCE_NAME}`);
    return {
      wavPath: outPath,
      pick: { formidLower6: 'MANUAL', variant: 1 },
      source: 'manual',
    };
  }

  const savedPick = await loadVoiceSpeakerRef(db, modId, speakerKey);
  if (savedPick) {
    const pickedEntry = findPickedEntry(savedPick, preferredEntry, getFallbackEntries);
    if (pickedEntry) {
      try {
        const entryDigest = sourceDigest(pickedEntry.absolutePath);
        const savedMarker = `saved:${pickedEntry.formidLower6}_${pickedEntry.variant}:${entryDigest}`;
        const outPath = await getOrReuseSpeakerReferenceWav(
          speakerKey,
          speakerCacheDir,
          savedMarker,
          () => getOrDecodeEntryReferenceWav(pickedEntry, entryCacheDir, workDir),
        );
        log.info(`Speaker ref "${speakerKey}": saved ${pickedEntry.fileName}`);
        return { wavPath: outPath, pick: savedPick, source: 'saved' };
      } catch (err) {
        log.warn(
          `Speaker ref "${speakerKey}": saved pick ${pickedEntry.fileName} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      log.warn(
        `Speaker ref "${speakerKey}": saved pick ${savedPick.formidLower6}_${savedPick.variant} not found on disk`,
      );
    }
  }

  const preferredScored = await scoreEntryReference(preferredEntry, entryCacheDir, workDir);
  if (preferredScored && preferredScored.score > Number.NEGATIVE_INFINITY) {
    return finalizeAutoReference(db, modId, speakerKey, speakerCacheDir, preferredScored);
  }

  let best: ScoredEntry | null = preferredScored;
  for (const entry of getFallbackEntries()) {
    const scored = await scoreEntryReference(entry, entryCacheDir, workDir);
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      best = scored;
    }
    if (scored.score >= AUTO_SELECT_GOOD_ENOUGH_SCORE) {
      break;
    }
  }

  if (!best || best.score === Number.NEGATIVE_INFINITY) {
    log.warn(`Speaker ref "${speakerKey}": no suitable reference found`);
    return null;
  }

  return finalizeAutoReference(db, modId, speakerKey, speakerCacheDir, best);
};
