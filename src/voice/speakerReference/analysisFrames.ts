export type AnalysisFrame = {
  rms: number;
  zcr: number;
};

export const analyzeFrames = (samples: Int16Array, sampleRate: number): AnalysisFrame[] => {
  const frameSamples = Math.max(1, Math.floor(sampleRate * 0.025));
  const frames: AnalysisFrame[] = [];

  for (let i = 0; i < samples.length; i += frameSamples) {
    const end = Math.min(i + frameSamples, samples.length);
    let sumSq = 0;
    let crossings = 0;
    let prev = samples[i] ?? 0;
    for (let j = i; j < end; j++) {
      const s = samples[j]!;
      sumSq += s * s;
      if (j > i && ((prev >= 0 && s < 0) || (prev < 0 && s >= 0))) crossings += 1;
      prev = s;
    }
    const len = end - i;
    frames.push({ rms: Math.sqrt(sumSq / len), zcr: crossings / len });
  }

  return frames;
};
