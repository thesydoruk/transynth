/**
 * Fish Speech `/v1/synthesize` hyperparameters.
 *
 * Defaults match historical project settings (pre-XTTS removal). Tune via
 * Settings → Voice or the regenerate modal. `matchLoudness` / `matchTiming`
 * are game-level only (xtts-engine post-process against the first speaker_wav).
 */

export type TtsSynthesisParams = {
  temperature?: number;
  repetitionPenalty?: number;
  topP?: number;
  matchLoudness?: boolean;
  matchTiming?: boolean;
};

/** Baseline sampling + xtts-engine post-process flags. */
export const TTS_SYNTHESIS_DEFAULTS: Required<TtsSynthesisParams> = {
  temperature: 0.65,
  repetitionPenalty: 1.2,
  topP: 0.8,
  matchLoudness: true,
  matchTiming: true,
};

const pickDefined = (params: TtsSynthesisParams): TtsSynthesisParams => {
  const out: TtsSynthesisParams = {};
  if (params.temperature != null) out.temperature = params.temperature;
  if (params.repetitionPenalty != null) out.repetitionPenalty = params.repetitionPenalty;
  if (params.topP != null) out.topP = params.topP;
  if (params.matchLoudness != null) out.matchLoudness = params.matchLoudness;
  if (params.matchTiming != null) out.matchTiming = params.matchTiming;
  return out;
};

/** Resolved synthesis params: defaults → optional per-call overrides. */
export const resolveTtsSynthesisParams = (
  overrides: Partial<TtsSynthesisParams> = {},
): Required<TtsSynthesisParams> => ({
  ...TTS_SYNTHESIS_DEFAULTS,
  ...pickDefined(overrides),
});

const appendFlag = (form: FormData, name: string, value: boolean | undefined): void => {
  if (value != null) form.append(name, value ? 'true' : 'false');
};

/** Append sampling and match flags to a multipart `/v1/synthesize` body. */
export const appendTtsSynthesisFormFields = (form: FormData, params: TtsSynthesisParams): void => {
  if (params.temperature != null) form.append('temperature', String(params.temperature));
  if (params.repetitionPenalty != null) {
    form.append('repetition_penalty', String(params.repetitionPenalty));
  }
  if (params.topP != null) form.append('top_p', String(params.topP));
  appendFlag(form, 'match_loudness', params.matchLoudness);
  appendFlag(form, 'match_timing', params.matchTiming);
};
