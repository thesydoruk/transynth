import { describe, expect, it } from '@jest/globals';
import { contextWindow, frameSpectra, MIMIC_MEL_BANDS, MIMIC_SAMPLE_RATE } from '../mimic/features';
import { generateLipsyncBlock, LIP_TAIL_SECONDS } from '../mimic/generate';
import { MIMIC_MODEL_FORMAT, parseMimicModel, runMimicModel } from '../mimic/model';
import { decodeLipsync, encodeLipsync } from '../w3speech/lipsync';

const tone = (hz: number, seconds: number): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * MIMIC_SAMPLE_RATE) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / MIMIC_SAMPLE_RATE),
  );

describe('frameSpectra', () => {
  it('puts a low tone in a low band and a high tone in a high one', () => {
    const peakBand = (pcm: Float32Array): number => {
      const spectra = frameSpectra(pcm, 5, 0.1);
      const frame = spectra.subarray(2 * MIMIC_MEL_BANDS, 3 * MIMIC_MEL_BANDS);
      return frame.indexOf(Math.max(...frame));
    };
    expect(peakBand(tone(300, 0.5))).toBeLessThan(10);
    expect(peakBand(tone(5000, 0.5))).toBeGreaterThan(30);
  });

  it('subtracts each band’s mean over the line', () => {
    const spectra = frameSpectra(tone(1000, 1), 20, 0.05);
    for (let m = 0; m < MIMIC_MEL_BANDS; m++) {
      let sum = 0;
      for (let f = 0; f < 20; f++) sum += spectra[f * MIMIC_MEL_BANDS + m]!;
      expect(Math.abs(sum / 20)).toBeLessThan(1e-4);
    }
  });

  it('clamps the context window at the line’s ends', () => {
    const spectra = Float32Array.from({ length: 3 * MIMIC_MEL_BANDS }, (_, i) =>
      Math.floor(i / MIMIC_MEL_BANDS),
    );
    const out = new Float32Array(3 * MIMIC_MEL_BANDS);
    contextWindow(spectra, 3, 0, 1, out);
    expect([out[0], out[MIMIC_MEL_BANDS], out[2 * MIMIC_MEL_BANDS]]).toEqual([0, 0, 1]);
  });
});

const b64 = (values: number[]): string =>
  Buffer.from(Float32Array.from(values).buffer).toString('base64');

/** A one-layer linear model: output 0 = sum of the window's first band, clamped to [0, 1]. */
const tinyModel = (trackCount: number, movingTrack: number, context = 0) => {
  const inputs = MIMIC_MEL_BANDS * (2 * context + 1);
  return parseMimicModel(
    JSON.stringify({
      format: MIMIC_MODEL_FORMAT,
      version: 1,
      context,
      melBands: MIMIC_MEL_BANDS,
      inputMean: b64(new Array(inputs).fill(0)),
      inputStd: b64(new Array(inputs).fill(1)),
      layers: [
        {
          inputs,
          outputs: 1,
          weights: b64(
            Array.from({ length: inputs }, (_, i) => (i % MIMIC_MEL_BANDS === 0 ? 1 : 0)),
          ),
          bias: b64([0.5]),
          activation: 'linear',
        },
      ],
      trackCount,
      movingTracks: [movingTrack],
      heldValues: new Array(trackCount).fill(0),
      outputMin: b64([0]),
      outputMax: b64([1]),
    }),
  );
};

describe('mimic model', () => {
  it('normalizes, runs and clamps', () => {
    const model = tinyModel(4, 2);
    const input = new Float32Array(MIMIC_MEL_BANDS);
    input[0] = 0.25;
    expect(runMimicModel(model, input)[0]).toBeCloseTo(0.75);
    input.fill(0);
    input[0] = 9;
    expect(runMimicModel(model, input)[0]).toBe(1);
  });

  it('rejects a file whose sizes disagree', () => {
    const json = JSON.parse(JSON.stringify({ format: 'something-else', version: 1 }));
    expect(() => parseMimicModel(JSON.stringify(json))).toThrow(/mimic model/i);
  });
});

describe('generateLipsyncBlock', () => {
  it('animates the moving pose for the take’s length and holds the rest', () => {
    const trackCount = 6;
    const template = encodeLipsync({
      fps: 30,
      duration: 1,
      frames: 31,
      dt: 1 / 30,
      rootCompression: 2,
      root: Buffer.alloc(64),
      tracks: Array.from({ length: trackCount }, () => ({ dt: 1 / 30, values: [0] })),
    });
    const takeDuration = 0.8;
    const block = generateLipsyncBlock({
      pcm: tone(440, takeDuration),
      takeDuration,
      model: tinyModel(trackCount, 3, 1),
      template,
    });
    const lipsync = decodeLipsync(block);
    expect(lipsync.duration).toBeCloseTo(takeDuration + LIP_TAIL_SECONDS);
    expect(lipsync.frames).toBe(Math.round((takeDuration + LIP_TAIL_SECONDS) * 30) + 1);
    expect(lipsync.tracks[3]!.values).toHaveLength(lipsync.frames);
    expect(lipsync.tracks.filter((_, t) => t !== 3).every((t) => t.values.length === 1)).toBe(true);
    for (let pos = 0; pos < 64; pos += 16)
      expect(lipsync.root.readFloatLE(pos)).toBeCloseTo(lipsync.dt);
  });
});

describe('generateLipsyncBlockOffThread', () => {
  it('produces on a worker thread exactly what the calling thread does', async () => {
    const { generateLipsyncBlockOffThread, closeLipsyncPool } =
      await import('../mimic/lipsyncPool');
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3pool-'));
    const inputs = MIMIC_MEL_BANDS * 3;
    const modelPath = path.join(dir, 'model.json');
    fs.writeFileSync(
      modelPath,
      JSON.stringify({
        format: MIMIC_MODEL_FORMAT,
        version: 1,
        context: 1,
        melBands: MIMIC_MEL_BANDS,
        inputMean: b64(new Array(inputs).fill(0)),
        inputStd: b64(new Array(inputs).fill(1)),
        layers: [
          {
            inputs,
            outputs: 1,
            weights: b64(Array.from({ length: inputs }, (_, i) => (i % 7) / 100)),
            bias: b64([0.2]),
            activation: 'linear',
          },
        ],
        trackCount: 3,
        movingTracks: [1],
        heldValues: [0, 0, 0],
        outputMin: b64([0]),
        outputMax: b64([1]),
      }),
    );
    const model = parseMimicModel(fs.readFileSync(modelPath, 'utf8'));
    const template = encodeLipsync({
      fps: 30,
      duration: 1,
      frames: 31,
      dt: 1 / 30,
      rootCompression: 2,
      root: Buffer.alloc(64),
      tracks: [
        { dt: 1 / 30, values: [0] },
        { dt: 1 / 30, values: [0] },
        { dt: 1 / 30, values: [0] },
      ],
    });
    const input = { pcm: tone(300, 0.7), takeDuration: 0.7, model, template };
    try {
      const here = await generateLipsyncBlockOffThread(input, null);
      const there = await generateLipsyncBlockOffThread(input, modelPath);
      expect(there).toEqual(here);
    } finally {
      closeLipsyncPool();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
