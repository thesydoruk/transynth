import {
  autoSelectTier,
  compareAutoSelectMetrics,
  isPreferredAutoSelectPick,
  pickAutoSelectCandidate,
  speakingRateSylPerSec,
  type AutoSelectMetrics,
} from '../autoSelect';

const clip = (
  partial: Partial<AutoSelectMetrics> & Pick<AutoSelectMetrics, 'durationSec'>,
): AutoSelectMetrics => ({
  activeSec: partial.activeSec ?? partial.durationSec,
  syllableCount: partial.syllableCount ?? null,
  qualityScore: partial.qualityScore ?? 20,
  ...partial,
});

describe('speakingRateSylPerSec', () => {
  it('divides syllables by active speech, not total duration', () => {
    expect(speakingRateSylPerSec(clip({ durationSec: 10, activeSec: 8, syllableCount: 40 }))).toBe(
      5,
    );
  });
});

describe('autoSelectTier', () => {
  it('ranks 8–12s in-tempo above a longer in-tempo fallback', () => {
    const preferred = clip({ durationSec: 10, syllableCount: 50 });
    const longer = clip({ durationSec: 13, syllableCount: 65 });
    expect(autoSelectTier(preferred)).toBe(0);
    expect(autoSelectTier(longer)).toBe(2);
    expect(compareAutoSelectMetrics(preferred, longer)).toBeLessThan(0);
  });

  it('treats missing transcript as duration-only (tempo not required)', () => {
    expect(autoSelectTier(clip({ durationSec: 10 }))).toBe(0);
    expect(isPreferredAutoSelectPick(clip({ durationSec: 10 }))).toBe(true);
  });
});

describe('pickAutoSelectCandidate', () => {
  it('picks 8–12s with tempo closest to 5 syl/s', () => {
    const fast = clip({ durationSec: 10, activeSec: 10, syllableCount: 80 });
    const target = clip({ durationSec: 10, activeSec: 10, syllableCount: 50 });
    expect(pickAutoSelectCandidate([fast, target])).toEqual(target);
  });

  it('falls back to the closest longer clip when no 8–12s file exists', () => {
    const short = clip({ durationSec: 5, syllableCount: 25 });
    const longer = clip({ durationSec: 13.2, syllableCount: 66 });
    const longest = clip({ durationSec: 13.8, syllableCount: 69 });
    expect(pickAutoSelectCandidate([short, longest, longer])).toEqual(longer);
  });

  it('keeps an 8–12s clip even when its tempo is outside 4–6 syl/s', () => {
    const preferredFast = clip({ durationSec: 10, syllableCount: 90 });
    const longer = clip({ durationSec: 13, syllableCount: 65 });
    expect(pickAutoSelectCandidate([preferredFast, longer])).toEqual(preferredFast);
  });

  it('ignores unusable clips', () => {
    const bad = clip({
      durationSec: 10,
      qualityScore: Number.NEGATIVE_INFINITY,
      syllableCount: 50,
    });
    const ok = clip({ durationSec: 5, syllableCount: 25 });
    expect(pickAutoSelectCandidate([bad, ok])).toEqual(ok);
  });
});
