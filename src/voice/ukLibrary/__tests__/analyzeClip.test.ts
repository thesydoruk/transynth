import { scoreUkVoiceQuality } from '../analyzeClip';

describe('scoreUkVoiceQuality', () => {
  it('scores silent audio near zero', () => {
    const samples = new Int16Array(22_050 * 3);
    expect(scoreUkVoiceQuality(samples, 22_050)).toBeLessThan(20);
  });

  it('scores dry speech-like bursts higher than silence', () => {
    const sampleRate = 22_050;
    const samples = new Int16Array(sampleRate * 4);
    // Three dry bursts with hard silence between (no reverb tail).
    for (const startSec of [0.2, 1.2, 2.2]) {
      const start = Math.floor(startSec * sampleRate);
      const end = start + Math.floor(0.45 * sampleRate);
      for (let i = start; i < end && i < samples.length; i += 1) {
        samples[i] = Math.sin(i / 40) * 8_000 + (i % 7) * 40;
      }
    }
    expect(scoreUkVoiceQuality(samples, sampleRate)).toBeGreaterThan(30);
  });
});
