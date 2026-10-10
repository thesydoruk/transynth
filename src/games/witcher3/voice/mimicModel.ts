/**
 * The trained mouth model.
 *
 * One ships with the plugin (`../mimic/mimic-model.json`, trained on the
 * Remastered game's English takes). An operator who retrains it —
 * `npm run w3:mimic-dataset` then `tools/witcher3-lipsync/train.py` — puts the
 * result at `<TOOLS_DIR>/witcher3/mimic-model.json`, beside the other tool
 * assets, or points `W3_MIMIC_MODEL_PATH` at it; either outranks the bundled
 * one. Without any readable model, synthesized lines keep the original mouth
 * animation stretched to their length.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '../../../logger';
import { PATHS } from '../../../paths';
import { loadMimicModel, type MimicModel } from '../mimic/model';

const BUNDLED_MODEL_PATH = fileURLToPath(new URL('../mimic/mimic-model.json', import.meta.url));

/** The model file in use: the env override, the operator's retrained copy, else the bundled one. */
export const w3MimicModelPath = (): string => {
  const fromEnv = process.env.W3_MIMIC_MODEL_PATH?.trim();
  if (fromEnv) return fromEnv;
  const retrained = path.join(PATHS.toolsDir, 'witcher3', 'mimic-model.json');
  return fs.existsSync(retrained) ? retrained : BUNDLED_MODEL_PATH;
};

let cached: { path: string; mtimeMs: number; model: MimicModel | null } | null = null;

/** The model at {@link w3MimicModelPath}, reloaded when the file changes; null when absent or unreadable. */
export const loadW3MimicModel = (): MimicModel | null => {
  const filePath = w3MimicModelPath();
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
  if (cached && cached.path === filePath && cached.mtimeMs === mtimeMs) return cached.model;
  let model: MimicModel | null = null;
  try {
    model = loadMimicModel(filePath);
  } catch (err) {
    log.warn(
      `Witcher 3 mimic model ${filePath} unreadable: ${err instanceof Error ? err.message : err}`,
    );
  }
  cached = { path: filePath, mtimeMs, model };
  return model;
};
