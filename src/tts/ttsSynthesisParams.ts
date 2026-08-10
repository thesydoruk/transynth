/**
 * Fish Speech `/v1/synthesize` sampling hyperparameters.
 *
 * Defaults match historical project settings (pre-XTTS removal). Tune via
 * Settings → Voice or the regenerate modal.
 */

export type TtsSynthesisParams = {
  temperature?: number;
  repetitionPenalty?: number;
  topP?: number;
};

/** Baseline sampling for Fish Speech dialogue synthesis. */
export const TTS_SYNTHESIS_DEFAULTS: Required<TtsSynthesisParams> = {
  temperature: 0.65,
  repetitionPenalty: 1.2,
  topP: 0.8,
};

const pickDefined = (params: TtsSynthesisParams): TtsSynthesisParams => {
  const out: TtsSynthesisParams = {};
  if (params.temperature != null) out.temperature = params.temperature;
  if (params.repetitionPenalty != null) out.repetitionPenalty = params.repetitionPenalty;
  if (params.topP != null) out.topP = params.topP;
  return out;
};

/** Resolved synthesis params: defaults → optional per-call overrides. */
export const resolveTtsSynthesisParams = (
  overrides: Partial<TtsSynthesisParams> = {},
): Required<TtsSynthesisParams> => ({
  ...TTS_SYNTHESIS_DEFAULTS,
  ...pickDefined(overrides),
});

/** Append sampling fields to a multipart `/v1/synthesize` body. */
export const appendTtsSynthesisFormFields = (form: FormData, params: TtsSynthesisParams): void => {
  if (params.temperature != null) form.append('temperature', String(params.temperature));
  if (params.repetitionPenalty != null) {
    form.append('repetition_penalty', String(params.repetitionPenalty));
  }
  if (params.topP != null) form.append('top_p', String(params.topP));
};
