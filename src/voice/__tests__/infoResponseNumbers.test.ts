import {
  voiceVariantFromOrdinal,
  _resetInfoVoiceResponseCacheForTests,
} from '../infoResponseNumbers';

describe('voiceVariantFromOrdinal', () => {
  it('maps NAM1 ordinal to TRDA response number', () => {
    expect(voiceVariantFromOrdinal(1, [2])).toBe(2);
    expect(voiceVariantFromOrdinal(1, [1, 3, 2])).toBe(1);
    expect(voiceVariantFromOrdinal(2, [1, 3, 2])).toBe(3);
    expect(voiceVariantFromOrdinal(3, [1, 3, 2])).toBe(2);
  });

  it('falls back to ordinal when map missing or short', () => {
    expect(voiceVariantFromOrdinal(2, undefined)).toBe(2);
    expect(voiceVariantFromOrdinal(3, [1, 2])).toBe(3);
  });
});

afterEach(() => {
  _resetInfoVoiceResponseCacheForTests();
});
