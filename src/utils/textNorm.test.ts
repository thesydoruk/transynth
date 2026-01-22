import { describe, it, expect } from 'vitest';
import { normalizeForHash, normalizeNoPunct, segmentPhrases } from './textNorm.js';

describe('normalizeForHash', () => {
  it('lowercases text', () => {
    expect(normalizeForHash('HELLO World')).toBe('hello world');
  });

  it('replaces numbers with ¤num¤', () => {
    expect(normalizeForHash('Item 42 costs 100 caps')).toBe('item ¤num¤ costs ¤num¤ caps');
  });

  it('replaces placeholders with ¤ph¤', () => {
    expect(normalizeForHash('Hello %s, you have %d')).toBe('hello ¤ph¤, you have ¤ph¤');
  });

  it('collapses whitespace', () => {
    expect(normalizeForHash('  lots   of   space  ')).toBe('lots of space');
  });

  it('handles empty string', () => {
    expect(normalizeForHash('')).toBe('');
  });

  it('handles undefined-like input', () => {
    expect(normalizeForHash(undefined as unknown as string)).toBe('');
  });

  it('normalizes compound text consistently', () => {
    const a = normalizeForHash('  Hello %s, you found 5 items in {chest}  ');
    const b = normalizeForHash('hello %s, you found 5 items in {chest}');
    expect(a).toBe(b);
  });
});

describe('normalizeNoPunct', () => {
  it('strips punctuation on top of normalizeForHash', () => {
    expect(normalizeNoPunct('Hello, World!')).toBe('hello world');
  });

  it('preserves placeholder and number tokens', () => {
    expect(normalizeNoPunct('Item %s costs 42 caps.')).toBe('item ¤ph¤ costs ¤num¤ caps');
  });

  it('collapses resulting whitespace', () => {
    expect(normalizeNoPunct('"Hello" -- World...')).toBe('hello world');
  });

  it('matches texts differing only by punctuation', () => {
    const a = normalizeNoPunct('Yes, sir!');
    const b = normalizeNoPunct('Yes sir');
    expect(a).toBe(b);
  });
});

describe('segmentPhrases', () => {
  it('splits on sentence-ending punctuation', () => {
    const result = segmentPhrases('Hello world. How are you? Fine!');
    expect(result).toEqual(['Hello world.', 'How are you?', 'Fine!']);
  });

  it('splits on semicolons and colons', () => {
    const result = segmentPhrases('Option A; Option B: the best');
    expect(result).toEqual(['Option A;', 'Option B:', 'the best']);
  });

  it('returns empty array for single-sentence text', () => {
    expect(segmentPhrases('Just one short sentence')).toEqual([]);
  });

  it('returns empty array for very short text', () => {
    expect(segmentPhrases('Hi')).toEqual([]);
  });

  it('filters out very short fragments', () => {
    // "A. B. Do something." → "A." (2 chars) and "B." (2 chars) are too short
    // Only 1 valid segment remains → returns empty (need ≥ 2)
    const result = segmentPhrases('A. B. Do something useful.');
    expect(result).toEqual([]);
  });

  it('splits on newlines', () => {
    const result = segmentPhrases('First line\nSecond line\nThird line');
    expect(result).toEqual(['First line', 'Second line', 'Third line']);
  });
});
