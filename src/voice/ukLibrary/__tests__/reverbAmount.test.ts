import { analyzeFrames } from '../../speakerReference/analysisFrames';
import { estimateReverbAmount, reverbQualityPenalty } from '../reverbAmount';
import { scoreUkVoiceQuality } from '../analyzeClip';

const sampleRate = 22_050;

/** Burst of tone, then hard silence (dry close-mic). */
const makeDryClip = (durationSec: number): Int16Array => {
  const samples = new Int16Array(Math.floor(sampleRate * durationSec));
  const speechEnd = Math.floor(samples.length * 0.55);
  for (let i = 0; i < speechEnd; i += 1) {
    samples[i] = Math.sin(i / 35) * 10_000;
  }
  return samples;
};

/** Burst of tone with a long exponential decay (roomy / reverberant). */
const makeWetClip = (durationSec: number): Int16Array => {
  const samples = new Int16Array(Math.floor(sampleRate * durationSec));
  const speechEnd = Math.floor(samples.length * 0.45);
  for (let i = 0; i < speechEnd; i += 1) {
    samples[i] = Math.sin(i / 35) * 10_000;
  }
  const peak = 10_000;
  for (let i = speechEnd; i < samples.length; i += 1) {
    const t = (i - speechEnd) / sampleRate;
    // ~0.6 s RT-like decay still audible well into the "silence".
    samples[i] = Math.sin(i / 35) * peak * Math.exp(-t / 0.35);
  }
  return samples;
};

describe('estimateReverbAmount', () => {
  it('scores dry speech lower than reverberant decay', () => {
    const dry = estimateReverbAmount(analyzeFrames(makeDryClip(4), sampleRate));
    const wet = estimateReverbAmount(analyzeFrames(makeWetClip(4), sampleRate));
    expect(wet).toBeGreaterThan(dry + 0.2);
    expect(wet).toBeGreaterThan(0.35);
  });
});

describe('reverbQualityPenalty', () => {
  it('applies a heavy penalty for clear reverb', () => {
    expect(reverbQualityPenalty(0)).toBe(0);
    expect(reverbQualityPenalty(0.2)).toBeGreaterThanOrEqual(15);
    expect(reverbQualityPenalty(0.5)).toBeGreaterThanOrEqual(40);
    expect(reverbQualityPenalty(1)).toBe(80);
  });
});

describe('scoreUkVoiceQuality reverb', () => {
  it('substantially lowers quality for reverberant clips', () => {
    const dryScore = scoreUkVoiceQuality(makeDryClip(4), sampleRate);
    const wetScore = scoreUkVoiceQuality(makeWetClip(4), sampleRate);
    expect(dryScore).toBeGreaterThan(wetScore + 25);
    expect(wetScore).toBeLessThan(40);
  });
});
