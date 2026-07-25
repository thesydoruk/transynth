import { splitLongSourceText, splitLongPairedText } from '../splitLongText';
import { mergeVerifyPartResults } from '../verifyPipeline/verifyLongText';

describe('splitLongSourceText', () => {
  it('returns the original text when under the limit', () => {
    expect(splitLongSourceText('Short text.', 100)).toEqual(['Short text.']);
  });

  it('splits on paragraph breaks', () => {
    const text = 'First paragraph.\n\nSecond paragraph with more words here.';
    const parts = splitLongSourceText(text, 25);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
  });

  it('splits on sentence boundaries', () => {
    const text = 'Alpha sentence. Beta sentence. Gamma sentence.';
    const parts = splitLongSourceText(text, 20);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.join('')).toBe(text);
  });

  it('never splits inside mask tokens', () => {
    const text = `${'A'.repeat(40)}¤PH0¤${'B'.repeat(40)}`;
    const parts = splitLongSourceText(text, 50);
    expect(parts.join('')).toBe(text);
    for (const part of parts) {
      expect(part.includes('¤PH') && !part.includes('¤PH0¤')).toBe(false);
    }
  });
});

describe('splitLongPairedText', () => {
  it('keeps short pairs intact', () => {
    expect(splitLongPairedText('Hello.', 'Привіт.', 100)).toEqual([
      { source: 'Hello.', translation: 'Привіт.' },
    ]);
  });

  it('aligns paragraph pairs when counts match', () => {
    const source = 'Para one.\n\nPara two is longer than the first.';
    const translation = 'Абзац один.\n\nАбзац два довший за перший.';
    const parts = splitLongPairedText(source, translation, 20);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.source).join('')).toBe(source);
    expect(parts.map((part) => part.translation).join('')).toBe(translation);
  });

  it('falls back to proportional split when paragraph counts differ', () => {
    const source = `${'A'.repeat(80)}.${'B'.repeat(80)}.`;
    const translation = `${'У'.repeat(120)}.`;
    const parts = splitLongPairedText(source, translation, 90);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.map((part) => part.source).join('')).toBe(source);
    expect(parts.map((part) => part.translation).join('')).toBe(translation);
  });
});

describe('mergeVerifyPartResults', () => {
  it('uses the worst verdict across parts', () => {
    const merged = mergeVerifyPartResults(
      [
        { id: 1, verdict: 'ok', reason: 'Fine', confidence: 1, suggestion: null },
        {
          id: 1,
          verdict: 'incorrect',
          reason: 'Broken token',
          confidence: 0.9,
          suggestion: 'Fix',
        },
      ],
      1,
    );
    expect(merged.verdict).toBe('incorrect');
    expect(merged.reason).toContain('Broken token');
    expect(merged.suggestion).toBe('Fix');
  });

  it('joins suggestions from multiple parts', () => {
    const merged = mergeVerifyPartResults(
      [
        {
          id: 2,
          verdict: 'suspicious',
          reason: 'Part one',
          confidence: 0.8,
          suggestion: 'One',
        },
        {
          id: 2,
          verdict: 'suspicious',
          reason: 'Part two',
          confidence: 0.7,
          suggestion: 'Two',
        },
      ],
      2,
    );
    expect(merged.suggestion).toBe('OneTwo');
    expect(merged.confidence).toBe(0.7);
  });
});
