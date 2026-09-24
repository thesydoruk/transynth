import { pickBestTake, takeNeedsRetry, type TtsTake } from '../ttsRetry';

const take = (voiceSimilarity: number | null, warning = ''): TtsTake => ({
  wav: Buffer.from([1]),
  voiceSimilarity,
  warning,
});

describe('takeNeedsRetry', () => {
  it('accepts a clean take at or above the threshold', () => {
    expect(takeNeedsRetry(take(0.3), 0.3)).toBe(false);
    expect(takeNeedsRetry(take(0.9), 0.3)).toBe(false);
  });

  it('retries a take the server flagged, whatever its score', () => {
    expect(takeNeedsRetry(take(0.9, 'silence (0.00s active speech)'), 0.3)).toBe(true);
  });

  it('retries a weak voice, and never on voice when the threshold is 0', () => {
    expect(takeNeedsRetry(take(0.2), 0.3)).toBe(true);
    expect(takeNeedsRetry(take(0.01), 0)).toBe(false);
  });

  it('cannot judge an unscored take by voice', () => {
    expect(takeNeedsRetry(take(null), 0.5)).toBe(false);
  });
});

describe('pickBestTake', () => {
  it('prefers a clean take over a flagged one with a higher score', () => {
    const clean = take(0.25);
    expect(pickBestTake([take(0.6, 'cutoff (14.2 syl/s)'), clean])).toBe(clean);
  });

  it('keeps the strongest clone match among clean takes', () => {
    const best = take(0.44);
    expect(pickBestTake([take(0.31), best, take(0.4)])).toBe(best);
  });

  it('keeps the earlier take on a tie and an unscored take last', () => {
    const first = take(0.4);
    expect(pickBestTake([first, take(0.4)])).toBe(first);
    const scored = take(0.1);
    expect(pickBestTake([take(null), scored])).toBe(scored);
  });

  it('refuses an empty list', () => {
    expect(() => pickBestTake([])).toThrow();
  });
});
