import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../../voice/voiceToolPaths';
import { encodeAudioToOpusWem, opusWemDuration, parseOpusWem } from '../audio/opusWem';
import { MIMIC_MEL_BANDS } from '../mimic/features';
import { LIP_TAIL_SECONDS } from '../mimic/generate';
import { MIMIC_MODEL_FORMAT, parseMimicModel } from '../mimic/model';
import { buildW3Take } from '../voice/buildTake';
import { buildW3SpeechAudio, parseW3SpeechAudio } from '../w3speech';
import { decodeLipsync, encodeLipsync } from '../w3speech/lipsync';

let dir: string;
const tonePath = (seconds: number): string => path.join(dir, `tone_${seconds}.wav`);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3take-'));
  for (const seconds of [1, 1.6]) {
    await execFileAsync(resolveFfmpegPath(), [
      '-y',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=330:duration=${seconds}`,
      tonePath(seconds),
    ]);
  }
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const TRACKS = 6;
const originalLip = (): Buffer =>
  encodeLipsync({
    fps: 30,
    duration: 1.064,
    frames: 33,
    dt: Math.fround(1.064 / 32),
    rootCompression: 2,
    root: Buffer.alloc(64),
    tracks: Array.from({ length: TRACKS }, (_, t) => ({
      dt: Math.fround(1.064 / 32),
      values: t === 2 ? Array.from({ length: 33 }, (_, i) => Math.fround(i / 40)) : [0],
    })),
  });

const originalAudio = async (): Promise<Buffer> => {
  const take = await encodeAudioToOpusWem(tonePath(1));
  return buildW3SpeechAudio(take, opusWemDuration(parseOpusWem(take)));
};

describe('buildW3Take', () => {
  it('encodes the new line and stretches the original mouth to it without a model', async () => {
    const lip = originalLip();
    const built = await buildW3Take({
      audioPath: tonePath(1.6),
      originalAudio: await originalAudio(),
      originalLip: lip,
    });
    expect(built.lipSource).toBe('retimed');
    expect(built.duration).toBeCloseTo(1.6, 1);
    expect(parseW3SpeechAudio(built.audio).duration).toBeCloseTo(built.duration);
    expect(built.lip.length).toBe(lip.length);
    expect(decodeLipsync(built.lip).duration).toBeCloseTo(built.duration + LIP_TAIL_SECONDS);
  });

  it('animates the mouth from the audio when a model is given', async () => {
    const inputs = MIMIC_MEL_BANDS;
    const b64 = (values: number[]) =>
      Buffer.from(Float32Array.from(values).buffer).toString('base64');
    const model = parseMimicModel(
      JSON.stringify({
        format: MIMIC_MODEL_FORMAT,
        version: 1,
        context: 0,
        melBands: MIMIC_MEL_BANDS,
        inputMean: b64(new Array(inputs).fill(0)),
        inputStd: b64(new Array(inputs).fill(1)),
        layers: [
          {
            inputs,
            outputs: 1,
            weights: b64(new Array(inputs).fill(0.01)),
            bias: b64([0.3]),
            activation: 'linear',
          },
        ],
        trackCount: TRACKS,
        movingTracks: [2],
        heldValues: new Array(TRACKS).fill(0),
        outputMin: b64([0]),
        outputMax: b64([1]),
      }),
    );
    const built = await buildW3Take({
      audioPath: tonePath(1.6),
      originalAudio: await originalAudio(),
      originalLip: originalLip(),
      model,
    });
    expect(built.lipSource).toBe('model');
    const lipsync = decodeLipsync(built.lip);
    expect(lipsync.tracks[2]!.values.length).toBe(lipsync.frames);
    expect(lipsync.duration).toBeCloseTo(built.duration + LIP_TAIL_SECONDS);
  });

  it('keeps a line without an animation without one', async () => {
    const built = await buildW3Take({
      audioPath: tonePath(1),
      originalAudio: await originalAudio(),
      originalLip: Buffer.alloc(0),
    });
    expect(built).toMatchObject({ lipSource: 'none', lip: Buffer.alloc(0) });
  });
});
