import { describe, expect, it } from 'vitest';
import { formatVoiceSimilarity, voiceSimilarityTone } from '../voiceSimilarity';

describe('voiceSimilarityTone', () => {
  it('marks the retry floor as fail', () => {
    expect(voiceSimilarityTone(0.24)).toBe('fail');
    expect(voiceSimilarityTone(0.25)).toBe('warn');
  });

  it('marks the warn band separately from a passing clone', () => {
    expect(voiceSimilarityTone(0.29)).toBe('warn');
    expect(voiceSimilarityTone(0.3)).toBe('ok');
  });
});

describe('formatVoiceSimilarity', () => {
  it('shows two decimals', () => {
    expect(formatVoiceSimilarity(0.412)).toBe('0.41');
  });
});
