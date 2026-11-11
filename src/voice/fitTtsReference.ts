/**
 * The TTS server (vLLM-Omni Fish Speech) refuses reference audio shorter than
 * about one second or longer than 30 s. A line whose own take falls outside
 * that range never got a voice: every job sent the same clip and failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readPcmFromWav, wavDurationSec } from './speakerReference/pcm';
import type { VoiceTtsRefClip } from './pickShortVoiceReferences';

/** Longest reference the server takes, with a margin. */
export const TTS_REFERENCE_MAX_SEC = 29;
/** Shortest total reference the server takes, with a margin. */
export const TTS_REFERENCE_MIN_SEC = 1.2;
/** A short clip is padded with trailing silence up to this length. */
const TTS_REFERENCE_PAD_SEC = 1.5;

const writeMonoWav = (filePath: string, samples: Int16Array, sampleRate: number): void => {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buffer.writeInt16LE(samples[i]!, 44 + i * 2);
  fs.writeFileSync(filePath, buffer);
};

/** Copy of `wavPath` cut or padded with silence to `seconds`, next to it. */
export const writeWavOfLength = (wavPath: string, seconds: number, suffix: string): string => {
  const { samples, sampleRate } = readPcmFromWav(wavPath);
  const out = new Int16Array(Math.round(seconds * sampleRate));
  out.set(samples.subarray(0, out.length));
  const parsed = path.parse(wavPath);
  const target = path.join(parsed.dir, `${parsed.name}.${suffix}.wav`);
  writeMonoWav(target, out, sampleRate);
  return target;
};

export const totalClipSec = (clips: VoiceTtsRefClip[]): number =>
  clips.reduce((sum, clip) => sum + wavDurationSec(clip.wavPath), 0);

/** The line take cut to the server's limit. Its transcript no longer matches, so none is sent. */
export const trimmedLineClip = (clip: VoiceTtsRefClip): VoiceTtsRefClip => ({
  ...clip,
  wavPath: writeWavOfLength(clip.wavPath, TTS_REFERENCE_MAX_SEC, 'trim'),
  speakerText: '',
});

/** Pad the first clip with trailing silence when all clips together are too short. */
export const padShortClips = (clips: VoiceTtsRefClip[]): VoiceTtsRefClip[] => {
  const total = totalClipSec(clips);
  if (clips.length === 0 || total <= 0 || total >= TTS_REFERENCE_MIN_SEC) return clips;
  const first = clips[0]!;
  const firstSec = wavDurationSec(first.wavPath);
  const padTo = firstSec + (TTS_REFERENCE_PAD_SEC - total);
  return [{ ...first, wavPath: writeWavOfLength(first.wavPath, padTo, 'pad') }, ...clips.slice(1)];
};
