import { scoreUkVoiceQuality } from '../analyzeClip';

describe('scoreUkVoiceQuality', () => {
  it('scores silent audio near zero', () => {
    const samples = new Int16Array(22_050 * 3);
    expect(scoreUkVoiceQuality(samples, 22_050)).toBeLessThan(20);
  });

  it('scores active speech-like noise higher than silence', () => {
    const samples = new Int16Array(22_050 * 4);
    for (let i = 0; i < samples.length; i += 1) {
      // Rough voiced-ish energy without perfect periodicity.
      samples[i] = Math.sin(i / 40) * 8_000 + (i % 7) * 40;
    }
    expect(scoreUkVoiceQuality(samples, 22_050)).toBeGreaterThan(30);
  });
});
