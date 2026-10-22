import { collectTakes, pickBestTake, takeNeedsRetry, type TtsTake } from '../ttsRetry';

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

describe('collectTakes', () => {
  const sequence = (...takes: TtsTake[]) => {
    let calls = 0;
    const next = async () => {
      if (calls >= takes.length) throw new Error('more takes than scripted');
      return takes[calls++];
    };
    return { next, calls: () => calls };
  };

  it('makes one take when the first passes', async () => {
    const s = sequence(take(0.5));
    expect(await collectTakes(s.next, { retryBelow: 0.4, retries: 8 })).toHaveLength(1);
  });

  it('stops at the first take that passes instead of spending the whole budget', async () => {
    const s = sequence(take(0.2), take(0.1, 'cutoff (14.2 syl/s)'), take(0.45), take(0.9));
    const takes = await collectTakes(s.next, { retryBelow: 0.4, retries: 8 });
    expect(takes).toHaveLength(3);
    expect(s.calls()).toBe(3);
  });

  it('spends at most `retries` extra takes when none passes', async () => {
    const s = sequence(take(0.1), take(0.1), take(0.1), take(0.1));
    expect(await collectTakes(s.next, { retryBelow: 0.4, retries: 2 })).toHaveLength(3);
  });

  it('never retries with a zero budget', async () => {
    const s = sequence(take(0.1, 'silence'));
    expect(await collectTakes(s.next, { retryBelow: 0.4, retries: 0 })).toHaveLength(1);
  });
});
