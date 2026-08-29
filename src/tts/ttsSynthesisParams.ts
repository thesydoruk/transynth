/**
 * Fish Speech `/v1/synthesize` post-process flags.
 *
 * Sampling (`temperature`, `top_p`, `repetition_penalty`) is fixed at vLLM
 * startup in xtts-engine, not per request. Tune via `matchLoudness` /
 * `matchTiming` per game in Settings → Voice.
 */

export type TtsSynthesisParams = {
  matchLoudness?: boolean;
  matchTiming?: boolean;
};

/** Baseline xtts-engine post-process flags. */
export const TTS_SYNTHESIS_DEFAULTS: Required<TtsSynthesisParams> = {
  matchLoudness: true,
  matchTiming: true,
};

const pickDefined = (params: TtsSynthesisParams): TtsSynthesisParams => {
  const out: TtsSynthesisParams = {};
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

/** Append match flags to a multipart `/v1/synthesize` body. */
export const appendTtsSynthesisFormFields = (form: FormData, params: TtsSynthesisParams): void => {
  appendFlag(form, 'match_loudness', params.matchLoudness);
  appendFlag(form, 'match_timing', params.matchTiming);
};
