import fs from 'node:fs';
import path from 'node:path';
import { log } from '../logger';
import { decodeAudioToReferenceWav } from '../voice/ffmpegAudio';
import { extractXwmFromFuzFile } from '../formats/fuz';
import { resolveVoiceRootRel, type VoiceFileEntry } from './discoverVoiceFiles';

const MANUAL_REFERENCE_NAME = '_reference.wav';

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

export type SpeakerReferencePool = Map<string, string>;

/**
 * Pick one decoded reference WAV per speaker folder.
 * Manual override: `<voiceRoot>/<Speaker>/_reference.wav`.
 */
export const buildSpeakerReferencePool = async (
  entries: VoiceFileEntry[],
  packageDir: string,
  pluginRelPath: string,
  cacheDir: string,
): Promise<SpeakerReferencePool> => {
  const voiceRootRel = resolveVoiceRootRel(pluginRelPath);
  const voiceRootAbs = path.join(packageDir, ...voiceRootRel.split('/'));
  const bySpeaker = new Map<string, VoiceFileEntry[]>();

  for (const entry of entries) {
    const speaker = voiceSpeakerKey(entry, voiceRootRel);
    if (!speaker) continue;
    const list = bySpeaker.get(speaker) ?? [];
    list.push(entry);
    bySpeaker.set(speaker, list);
  }

  const pool: SpeakerReferencePool = new Map();

  for (const [speaker, speakerEntries] of bySpeaker) {
    const manualPath = path.join(voiceRootAbs, speaker, MANUAL_REFERENCE_NAME);
    const speakerCacheDir = path.join(cacheDir, 'speaker-ref', speaker);
    fs.mkdirSync(speakerCacheDir, { recursive: true });

    if (fs.existsSync(manualPath)) {
      const outPath = path.join(speakerCacheDir, MANUAL_REFERENCE_NAME);
      await decodeAudioToReferenceWav(manualPath, outPath);
      pool.set(speaker, outPath);
      log.info(`Speaker ref "${speaker}": manual ${MANUAL_REFERENCE_NAME}`);
      continue;
    }

    let bestPath: string | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestEntry: VoiceFileEntry | null = null;

    for (const entry of speakerEntries) {
      const candidatePath = path.join(
        speakerCacheDir,
        `${entry.formidLower6}_${entry.variant}.ref.wav`,
      );
      try {
        await decodeEntryToReferenceWav(entry, candidatePath, speakerCacheDir);
        const score = scoreReferenceWav(candidatePath);
        if (score > bestScore) {
          bestScore = score;
          bestPath = candidatePath;
          bestEntry = entry;
        }
      } catch (err) {
        log.warn(
          `Speaker ref "${speaker}": skip ${entry.fileName}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (bestPath && bestEntry) {
      pool.set(speaker, bestPath);
      log.info(
        `Speaker ref "${speaker}": auto ${bestEntry.fileName} (score=${bestScore.toFixed(1)})`,
      );
    } else {
      log.warn(`Speaker ref "${speaker}": no suitable reference found`);
    }
  }

  return pool;
};
