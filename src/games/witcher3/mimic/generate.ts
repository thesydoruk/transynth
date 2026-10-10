/**
 * A lip block for a new take: listen to it, predict the face frame by frame,
 * and encode the result the way the game's own blocks are.
 */
import { contextWindow, frameSpectra, MIMIC_MEL_BANDS } from './features';
import { runMimicModel, type MimicModel } from './model';
import { decodeLipsync, encodeLipsync, type Lipsync } from '../w3speech/lipsync';

/** The game animates lips at ~30 fps (26–30 measured). */
const FPS = 30;
/** Lip animations run this much past the take (median over the game's lines). */
export const LIP_TAIL_SECONDS = 0.064;

/** Three-tap smoothing; the model predicts frames independently and jitters. */
const smooth = (values: number[]): number[] =>
  values.map((v, i) => {
    const prev = values[Math.max(0, i - 1)]!;
    const next = values[Math.min(values.length - 1, i + 1)]!;
    return 0.25 * prev + 0.5 * v + 0.25 * next;
  });

export type GenerateLipsyncInput = {
  /** The new take, mono, at `MIMIC_SAMPLE_RATE`. */
  pcm: Float32Array;
  /** The take's length in seconds (what the speech row stores). */
  takeDuration: number;
  model: MimicModel;
  /**
   * A lip block of the line being replaced. Only its root-bone records are
   * kept (retimed) — they are the same constant pose in every game block — so
   * the new block differs from the game's own in nothing but the animation.
   */
  template: Buffer;
};

export const generateLipsyncBlock = (input: GenerateLipsyncInput): Buffer => {
  const { model } = input;
  const template = decodeLipsync(input.template);
  if (template.tracks.length !== model.trackCount) {
    throw new Error(`Template has ${template.tracks.length} tracks, model ${model.trackCount}`);
  }
  const duration = input.takeDuration + LIP_TAIL_SECONDS;
  const frames = Math.max(2, Math.round(duration * FPS) + 1);
  const dt = duration / (frames - 1);

  const spectra = frameSpectra(input.pcm, frames, dt);
  const window = new Float32Array(MIMIC_MEL_BANDS * (2 * model.context + 1));
  const predicted = model.movingTracks.map(() => new Array<number>(frames));
  for (let f = 0; f < frames; f++) {
    contextWindow(spectra, frames, f, model.context, window);
    const out = runMimicModel(model, window);
    for (let o = 0; o < out.length; o++) predicted[o]![f] = out[o]!;
  }

  const byTrack = new Map(model.movingTracks.map((track, o) => [track, smooth(predicted[o]!)]));
  // The root's records carry the frame interval too.
  const root = Buffer.from(template.root);
  for (let pos = 0; pos + 16 <= root.length; pos += 16) root.writeFloatLE(dt, pos);
  const lipsync: Lipsync = {
    fps: (frames - 1) / duration,
    duration,
    frames,
    dt,
    rootCompression: template.rootCompression,
    root,
    tracks: Array.from({ length: model.trackCount }, (_, track) => ({
      dt,
      values: (byTrack.get(track) ?? [model.heldValues[track] ?? 0]).map((v) => Math.fround(v)),
    })),
  };
  return encodeLipsync(lipsync);
};
