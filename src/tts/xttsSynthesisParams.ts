/**
 * XTTS /v1/synthesize hyperparameters for game dialogue.
 *
 * Server defaults (temperature 0.65, length_penalty 1.0, repetition_penalty 2.0,
 * speed 1.0, splitting on) tend to sound slightly slow/drawn-out for short FO4 lines.
 * Overrides below tighten pacing; tune further via project voice settings in the UI.
 */

export type XttsSynthesisParams = {
  temperature?: number;
  lengthPenalty?: number;
  repetitionPenalty?: number;
  topK?: number;
  topP?: number;
  speed?: number;
  enableTextSplitting?: boolean;
};

/** Baseline pacing for short voiced game lines (overridable via env / per-call). */
export const XTTS_GAME_DIALOGUE_DEFAULTS: XttsSynthesisParams = {
  speed: 1.1,
  lengthPenalty: 1.2,
  repetitionPenalty: 2.0,
  topK: 50,
  topP: 0.85,
  enableTextSplitting: false,
  temperature: 0.6,
};

const pickDefined = (params: XttsSynthesisParams): XttsSynthesisParams => {
  const out: XttsSynthesisParams = {};
  if (params.temperature != null) out.temperature = params.temperature;
  if (params.lengthPenalty != null) out.lengthPenalty = params.lengthPenalty;
  if (params.repetitionPenalty != null) out.repetitionPenalty = params.repetitionPenalty;
  if (params.topK != null) out.topK = params.topK;
  if (params.topP != null) out.topP = params.topP;
  if (params.speed != null) out.speed = params.speed;
  if (params.enableTextSplitting != null) out.enableTextSplitting = params.enableTextSplitting;
  return out;
};

/** Resolved synthesis params: game defaults → optional per-call overrides. */
export const resolveTtsSynthesisParams = (
  overrides: Partial<XttsSynthesisParams> = {},
): XttsSynthesisParams => ({
  ...XTTS_GAME_DIALOGUE_DEFAULTS,
  ...pickDefined(overrides),
});

export const appendXttsSynthesisFormFields = (
  form: FormData,
  params: XttsSynthesisParams,
): void => {
  if (params.temperature != null) form.append('temperature', String(params.temperature));
  if (params.lengthPenalty != null) form.append('length_penalty', String(params.lengthPenalty));
  if (params.repetitionPenalty != null) {
    form.append('repetition_penalty', String(params.repetitionPenalty));
  }
  if (params.topK != null) form.append('top_k', String(params.topK));
  if (params.topP != null) form.append('top_p', String(params.topP));
  if (params.speed != null) form.append('speed', String(params.speed));
  if (params.enableTextSplitting != null) {
    form.append('enable_text_splitting', params.enableTextSplitting ? 'true' : 'false');
  }
};
