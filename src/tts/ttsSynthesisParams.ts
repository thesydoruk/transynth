/**
 * Fish Speech `/v1/synthesize` request parameters and the client-side retry policy.
 *
 * Sampling (`temperature`, `top_p`, `repetition_penalty`) is fixed at vLLM
 * startup in xtts-engine, not per request. Post-process flags come per game
 * (Settings → Voice → per-game TTS) and travel with the request.
 *
 * Retries never reach the server: xtts-engine makes one take and reports it
 * (`X-Synth-Warning` for silence / cutoff, `X-Voice-Similarity` for the clone
 * cosine). When the take carries a warning or scores below `retryBelow`, the
 * client asks for `retries` more takes and keeps the best (Settings → Voice →
 * Synthesis).
 */

export type TtsSynthesisParams = {
  matchLoudness?: boolean;
  matchTiming?: boolean;
  /** ECAPA cosine below which the first take is not accepted, 0–1. 0 = never retry on voice. */
  retryBelow?: number;
  /** Extra takes to generate after a failing first take, 0–8. 0 = keep the first take. */
  retries?: number;
};

const TTS_RETRIES_MAX = 8;

/** Baseline request parameters and retry policy. */
export const TTS_SYNTHESIS_DEFAULTS: Required<TtsSynthesisParams> = {
  matchLoudness: true,
  matchTiming: true,
  retryBelow: 0.3,
  retries: 4,
};

export const clampTtsRetries = (value: number): number => {
  if (!Number.isFinite(value)) return TTS_SYNTHESIS_DEFAULTS.retries;
  return Math.min(TTS_RETRIES_MAX, Math.max(0, Math.round(value)));
};

export const clampTtsRetryBelow = (value: number): number => {
  if (!Number.isFinite(value)) return TTS_SYNTHESIS_DEFAULTS.retryBelow;
  return Math.min(1, Math.max(0, value));
};

const pickDefined = (params: TtsSynthesisParams): TtsSynthesisParams => {
  const out: TtsSynthesisParams = {};
  if (params.matchLoudness != null) out.matchLoudness = params.matchLoudness;
  if (params.matchTiming != null) out.matchTiming = params.matchTiming;
  if (params.retryBelow != null) out.retryBelow = clampTtsRetryBelow(params.retryBelow);
  if (params.retries != null) out.retries = clampTtsRetries(params.retries);
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

/** Append the match flags to a multipart `/v1/synthesize` body. The retry policy stays here. */
export const appendTtsSynthesisFormFields = (form: FormData, params: TtsSynthesisParams): void => {
  appendFlag(form, 'match_loudness', params.matchLoudness);
  appendFlag(form, 'match_timing', params.matchTiming);
};
