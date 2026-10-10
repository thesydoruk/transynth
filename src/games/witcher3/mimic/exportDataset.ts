#!/usr/bin/env tsx
/**
 * Read training data for the mouth model out of a Witcher 3 install.
 *
 * For a spread of the game's lines: the take's per-frame log-mel spectra (the
 * model's input, built by the same `features.ts` the generator uses) and the
 * 148 mimic track values CD PROJEKT RED animated for it (the target).
 *
 * Usage:
 *   npm run w3:mimic-dataset -- --speech "<game>/content/content0/enpc.w3speech" --out <dir> [--lines 12000]
 *
 * Writes `<dir>/index.json`, `<dir>/spectra.f32` (frames × 40) and
 * `<dir>/targets.f32` (frames × 148), little-endian. Train with
 * `python tools/witcher3-lipsync/train.py <dir>`.
 */
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { decodeOpusWemToPcm, parseOpusWem } from '../audio/opusWem';
import {
  parseW3SpeechAudio,
  readW3SpeechBlock,
  readW3SpeechIndex,
  type W3SpeechRow,
} from '../w3speech';
import { decodeLipsync } from '../w3speech/lipsync';
import { frameSpectra, MIMIC_MEL_BANDS, MIMIC_SAMPLE_RATE } from './features';

const TRACKS = 148;
const PARALLEL = 8;

const argv = await yargs(hideBin(process.argv))
  .option('speech', { type: 'string', demandOption: true, describe: 'A game .w3speech file' })
  .option('out', { type: 'string', demandOption: true, describe: 'Output directory' })
  .option('lines', { type: 'number', default: 12000, describe: 'Lines to sample, spread evenly' })
  .help()
  .parse();

type LineSample = { id: number; frames: number; spectra: Float32Array; targets: Float32Array };

const sampleLine = async (fd: number, row: W3SpeechRow): Promise<LineSample | null> => {
  const audio = parseW3SpeechAudio(readW3SpeechBlock(fd, row.audioOffset, row.audioSize));
  if (parseOpusWem(audio.take).channels !== 1) return null;
  const lipsync = decodeLipsync(readW3SpeechBlock(fd, row.lipOffset, row.lipSize));
  if (lipsync.tracks.length !== TRACKS) return null;
  const pcm = await decodeOpusWemToPcm(audio.take, MIMIC_SAMPLE_RATE);
  const targets = new Float32Array(lipsync.frames * TRACKS);
  lipsync.tracks.forEach((track, t) => {
    // A track shorter than the animation holds its last value.
    for (let f = 0; f < lipsync.frames; f++) {
      targets[f * TRACKS + t] = track.values[Math.min(f, track.values.length - 1)]!;
    }
  });
  return {
    id: row.id,
    frames: lipsync.frames,
    spectra: frameSpectra(pcm, lipsync.frames, lipsync.dt),
    targets,
  };
};

const fd = fs.openSync(argv.speech, 'r');
const index = readW3SpeechIndex(fd);
const withLips = index.rows.filter((row) => row.lipSize > 0);
const count = Math.min(argv.lines, withLips.length);
const picked = Array.from(
  { length: count },
  (_, i) => withLips[Math.floor((i * withLips.length) / count)]!,
);

fs.mkdirSync(argv.out, { recursive: true });
const spectraOut = fs.openSync(path.join(argv.out, 'spectra.f32'), 'w');
const targetsOut = fs.openSync(path.join(argv.out, 'targets.f32'), 'w');
const lines: Array<{ id: number; frames: number; offset: number }> = [];
let totalFrames = 0;
let done = 0;

const write = (sample: LineSample): void => {
  fs.writeSync(spectraOut, Buffer.from(sample.spectra.buffer));
  fs.writeSync(targetsOut, Buffer.from(sample.targets.buffer));
  lines.push({ id: sample.id, frames: sample.frames, offset: totalFrames });
  totalFrames += sample.frames;
};

const queue = [...picked];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length > 0) {
      const sample = await sampleLine(fd, queue.shift()!);
      if (sample) write(sample);
      if (++done % 500 === 0) console.log(`  ${done}/${count} lines, ${totalFrames} frames`);
    }
  }),
);
fs.closeSync(spectraOut);
fs.closeSync(targetsOut);
fs.writeFileSync(
  path.join(argv.out, 'index.json'),
  JSON.stringify({ melBands: MIMIC_MEL_BANDS, trackCount: TRACKS, totalFrames, lines }),
);
console.log(`Wrote ${lines.length} lines, ${totalFrames} frames to ${argv.out}`);
