/**
 * The mouth model: a small MLP from the audio around a frame to the face's
 * mimic poses at that frame.
 *
 * It is trained on the game's own lines — every English take and the lip
 * animation CD PROJEKT RED shipped with it — by
 * `tools/witcher3-lipsync/train.py`, from a dataset `exportDataset.ts` reads
 * out of the player's install. The weights shipped here (`mimic-model.json`,
 * held-out R² 0.54, jaw correlation 0.97) were trained on the Remastered
 * release's `content0/enpc.w3speech`; `voice/mimicModel.ts` prefers an
 * operator's retrained copy when there is one.
 *
 * Only the poses that ever move are predicted; the rest are held at the value
 * the game holds them at (almost always 0).
 */
import fs from 'node:fs';
import { MIMIC_MEL_BANDS } from './features';

export const MIMIC_MODEL_FORMAT = 'transynth-w3-mimic';

type Activation = 'gelu' | 'linear';

type DenseLayer = {
  inputs: number;
  outputs: number;
  /** Row-major `outputs × inputs`. */
  weights: Float32Array;
  bias: Float32Array;
  activation: Activation;
};

export type MimicModel = {
  /** Frames of audio context either side of the predicted one. */
  context: number;
  inputMean: Float32Array;
  inputStd: Float32Array;
  layers: DenseLayer[];
  /** All tracks of the face (148). */
  trackCount: number;
  /** Track index of each model output. */
  movingTracks: number[];
  /** Value of every track the model does not predict, indexed by track. */
  heldValues: number[];
  /** Per-output range seen in training; predictions are clamped to it. */
  outputMin: Float32Array;
  outputMax: Float32Array;
};

/** On-disk shape: arrays of floats as base64 little-endian f32. */
type MimicModelFile = {
  format: typeof MIMIC_MODEL_FORMAT;
  version: 1;
  context: number;
  melBands: number;
  inputMean: string;
  inputStd: string;
  layers: Array<{
    inputs: number;
    outputs: number;
    weights: string;
    bias: string;
    activation: Activation;
  }>;
  trackCount: number;
  movingTracks: number[];
  heldValues: number[];
  outputMin: string;
  outputMax: string;
};

const f32 = (base64: string, length: number, what: string): Float32Array => {
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length !== length * 4)
    throw new Error(`Mimic model ${what}: ${bytes.length / 4} values, expected ${length}`);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = bytes.readFloatLE(i * 4);
  return out;
};

export const parseMimicModel = (json: string): MimicModel => {
  const file = JSON.parse(json) as MimicModelFile;
  if (file.format !== MIMIC_MODEL_FORMAT || file.version !== 1)
    throw new Error('Not a mimic model file');
  if (file.melBands !== MIMIC_MEL_BANDS)
    throw new Error(`Mimic model expects ${file.melBands} mel bands`);
  const inputs = MIMIC_MEL_BANDS * (2 * file.context + 1);
  const layers = file.layers.map((layer, i) => ({
    inputs: layer.inputs,
    outputs: layer.outputs,
    weights: f32(layer.weights, layer.inputs * layer.outputs, `layer ${i} weights`),
    bias: f32(layer.bias, layer.outputs, `layer ${i} bias`),
    activation: layer.activation,
  }));
  if (layers[0]?.inputs !== inputs)
    throw new Error('Mimic model input size does not match its context');
  if (layers.at(-1)?.outputs !== file.movingTracks.length) {
    throw new Error('Mimic model output size does not match its tracks');
  }
  return {
    context: file.context,
    inputMean: f32(file.inputMean, inputs, 'input mean'),
    inputStd: f32(file.inputStd, inputs, 'input std'),
    layers,
    trackCount: file.trackCount,
    movingTracks: file.movingTracks,
    heldValues: file.heldValues,
    outputMin: f32(file.outputMin, file.movingTracks.length, 'output min'),
    outputMax: f32(file.outputMax, file.movingTracks.length, 'output max'),
  };
};

export const loadMimicModel = (filePath: string): MimicModel =>
  parseMimicModel(fs.readFileSync(filePath, 'utf8'));

/** tanh approximation of GELU, as PyTorch's `approximate='tanh'`. */
const gelu = (x: number): number =>
  0.5 * x * (1 + Math.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x)));

/** One frame through the network; `input` is normalized in place. */
export const runMimicModel = (model: MimicModel, input: Float32Array): Float32Array => {
  for (let i = 0; i < input.length; i++)
    input[i] = (input[i]! - model.inputMean[i]!) / model.inputStd[i]!;
  let x = input;
  for (const layer of model.layers) {
    const y = new Float32Array(layer.outputs);
    for (let o = 0; o < layer.outputs; o++) {
      let sum = layer.bias[o]!;
      const row = o * layer.inputs;
      for (let i = 0; i < layer.inputs; i++) sum += layer.weights[row + i]! * x[i]!;
      y[o] = layer.activation === 'gelu' ? gelu(sum) : sum;
    }
    x = y;
  }
  for (let o = 0; o < x.length; o++)
    x[o] = Math.min(model.outputMax[o]!, Math.max(model.outputMin[o]!, x[o]!));
  return x;
};
