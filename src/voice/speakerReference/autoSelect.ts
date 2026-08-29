import {
  MAX_SPEAKING_RATE_SYL_PER_SEC,
  MIN_SPEAKING_RATE_SYL_PER_SEC,
  PREFERRED_REFERENCE_DURATION_MAX_SEC,
  PREFERRED_REFERENCE_DURATION_MIN_SEC,
  TARGET_SPEAKING_RATE_SYL_PER_SEC,
} from './constants';

export type AutoSelectMetrics = {
  durationSec: number;
  activeSec: number;
  /** Null when the English transcript is unknown or has no spoken syllables. */
  syllableCount: number | null;
  qualityScore: number;
};

const PREFERRED_DURATION_CENTER_SEC =
  (PREFERRED_REFERENCE_DURATION_MIN_SEC + PREFERRED_REFERENCE_DURATION_MAX_SEC) / 2;

export const speakingRateSylPerSec = (metrics: AutoSelectMetrics): number | null => {
  if (metrics.syllableCount == null || metrics.syllableCount <= 0 || metrics.activeSec <= 0) {
    return null;
  }
  return metrics.syllableCount / metrics.activeSec;
};

export const isPreferredReferenceDuration = (durationSec: number): boolean =>
  durationSec >= PREFERRED_REFERENCE_DURATION_MIN_SEC &&
  durationSec <= PREFERRED_REFERENCE_DURATION_MAX_SEC;

export const isLongerThanPreferredDuration = (durationSec: number): boolean =>
  durationSec > PREFERRED_REFERENCE_DURATION_MAX_SEC;

export const isSpeakingRateInBand = (rate: number | null): boolean =>
  rate != null && rate >= MIN_SPEAKING_RATE_SYL_PER_SEC && rate <= MAX_SPEAKING_RATE_SYL_PER_SEC;

/**
 * Tempo is required when we know the transcript. Without text, rank by duration only.
 */
export const meetsSpeakingRateRequirement = (metrics: AutoSelectMetrics): boolean => {
  if (metrics.syllableCount == null) return true;
  return isSpeakingRateInBand(speakingRateSylPerSec(metrics));
};

/** 0–1 = 8–12s (in-tempo first), 2–3 = closest longer, then shorter fallbacks. */
export const autoSelectTier = (metrics: AutoSelectMetrics): number => {
  const preferred = isPreferredReferenceDuration(metrics.durationSec);
  const longer = isLongerThanPreferredDuration(metrics.durationSec);
  const tempoOk = meetsSpeakingRateRequirement(metrics);
  if (preferred && tempoOk) return 0;
  if (preferred) return 1;
  if (longer && tempoOk) return 2;
  if (longer) return 3;
  if (tempoOk) return 4;
  return 5;
};

const rateDeviation = (metrics: AutoSelectMetrics): number => {
  const rate = speakingRateSylPerSec(metrics);
  return rate == null
    ? Number.POSITIVE_INFINITY
    : Math.abs(rate - TARGET_SPEAKING_RATE_SYL_PER_SEC);
};

/** Negative when `a` is a better speaker reference than `b`. */
export const compareAutoSelectMetrics = (a: AutoSelectMetrics, b: AutoSelectMetrics): number => {
  const tierDiff = autoSelectTier(a) - autoSelectTier(b);
  if (tierDiff !== 0) return tierDiff;

  const tier = autoSelectTier(a);
  if (tier === 0 || tier === 1) {
    const rateDiff = rateDeviation(a) - rateDeviation(b);
    if (Math.abs(rateDiff) > 1e-9) return rateDiff;
    return (
      Math.abs(a.durationSec - PREFERRED_DURATION_CENTER_SEC) -
      Math.abs(b.durationSec - PREFERRED_DURATION_CENTER_SEC)
    );
  }
  if (tier === 2 || tier === 3) {
    const durationDiff = a.durationSec - b.durationSec;
    if (Math.abs(durationDiff) > 1e-9) return durationDiff;
    return rateDeviation(a) - rateDeviation(b);
  }

  const shorterDiff = b.durationSec - a.durationSec;
  if (Math.abs(shorterDiff) > 1e-9) return shorterDiff;
  return rateDeviation(a) - rateDeviation(b);
};

export const isPreferredAutoSelectPick = (metrics: AutoSelectMetrics): boolean =>
  metrics.qualityScore > Number.NEGATIVE_INFINITY && autoSelectTier(metrics) === 0;

export const pickAutoSelectCandidate = <T extends AutoSelectMetrics>(candidates: T[]): T | null => {
  const usable = candidates.filter((item) => item.qualityScore > Number.NEGATIVE_INFINITY);
  if (usable.length === 0) return null;
  return usable.reduce((best, current) =>
    compareAutoSelectMetrics(current, best) < 0 ? current : best,
  );
};
