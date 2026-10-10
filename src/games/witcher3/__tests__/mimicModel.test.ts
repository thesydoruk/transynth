import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { loadMimicModel } from '../mimic/model';
import { w3MimicModelPath } from '../voice/mimicModel';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the bundled mouth model', () => {
  it('is a complete model for the game lip buffer', () => {
    const model = loadMimicModel(path.join(here, '..', 'mimic', 'mimic-model.json'));
    expect(model.trackCount).toBe(148);
    expect(model.movingTracks.length).toBeGreaterThan(0);
    expect(model.layers.length).toBeGreaterThan(1);
  });

  it('is what the plugin uses unless an operator supplies another', () => {
    const saved = process.env.W3_MIMIC_MODEL_PATH;
    process.env.W3_MIMIC_MODEL_PATH = '';
    try {
      expect(path.basename(w3MimicModelPath())).toBe('mimic-model.json');
      process.env.W3_MIMIC_MODEL_PATH = 'C:/elsewhere/own-model.json';
      expect(w3MimicModelPath()).toBe('C:/elsewhere/own-model.json');
    } finally {
      if (saved === undefined) delete process.env.W3_MIMIC_MODEL_PATH;
      else process.env.W3_MIMIC_MODEL_PATH = saved;
    }
  });
});
