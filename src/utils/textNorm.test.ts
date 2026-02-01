import { describe, it, expect } from 'vitest';
import { normalizeForHash, normalizeNoPunct, segmentPhrases, extractNumbers, transplantNumbers } from './textNorm.js';

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

// ── Numeric-invariant matching ────────────────────────────────────────────────

describe('extractNumbers', () => {
  it('extracts integers', () => {
    expect(extractNumbers('Damage: 150, Weight: 2')).toEqual(['150', '2']);
  });

  it('extracts decimal numbers', () => {
    expect(extractNumbers('Speed 3.14 and 0.5')).toEqual(['3.14', '0.5']);
  });

  it('returns empty array when no numbers', () => {
    expect(extractNumbers('Hello World')).toEqual([]);
  });

  it('preserves order of appearance', () => {
    expect(extractNumbers('Item 7, costs 100 caps, qty 3')).toEqual(['7', '100', '3']);
  });

  it('handles leading zeros', () => {
    expect(extractNumbers('Code 007')).toEqual(['007']);
  });
});

describe('transplantNumbers', () => {
  it('replaces old numbers with new in translation', () => {
    const result = transplantNumbers(
      'Шкода: 100, Вага: 5',
      ['100', '5'],
      ['150', '8'],
    );
    expect(result).toBe('Шкода: 150, Вага: 8');
  });

  it('returns translation unchanged when numbers are identical', () => {
    const result = transplantNumbers(
      'Шкода: 100',
      ['100'],
      ['100'],
    );
    expect(result).toBe('Шкода: 100');
  });

  it('returns null on count mismatch', () => {
    expect(transplantNumbers('Text 10 20', ['10', '20'], ['10'])).toBeNull();
  });

  it('returns null when old number is not found in translation', () => {
    expect(transplantNumbers('Текст без чисел', ['10'], ['20'])).toBeNull();
  });

  it('returns translation as-is for empty number arrays', () => {
    expect(transplantNumbers('No numbers here', [], [])).toBe('No numbers here');
  });

  it('replaces first occurrence only (positional)', () => {
    const result = transplantNumbers(
      '10 із 10 предметів',
      ['10', '10'],
      ['25', '50'],
    );
    expect(result).toBe('25 із 50 предметів');
  });

  it('handles multi-digit replacements of different lengths', () => {
    const result = transplantNumbers(
      'Рівень 5',
      ['5'],
      ['100'],
    );
    expect(result).toBe('Рівень 100');
  });
});
