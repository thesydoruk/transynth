import { buildSpeakerBaseline, effortZScores } from '../baseline';
import { applyEffortTag, decideVocalEffort } from '../decide';
import { extractEffortFeatures, type EffortFeatures } from '../features';

const SAMPLE_RATE = 44_100;

/**
 * A harmonic tone standing in for a voice: `f0` sets the pitch, `rolloff` how
 * fast the overtones fade (small = bright, pushed voice).
 */
const tone = (f0: number, rolloff: number, seconds = 1): Int16Array => {
  const samples = new Int16Array(Math.floor(SAMPLE_RATE * seconds));
  for (let i = 0; i < samples.length; i++) {
    let value = 0;
    for (let harmonic = 1; harmonic <= 12; harmonic++) {
      value +=
        Math.sin((2 * Math.PI * f0 * harmonic * i) / SAMPLE_RATE) / Math.pow(harmonic, rolloff);
    }
    samples[i] = Math.round(value * 6000);
  }
  return samples;
};

const semitonesToHz = (st: number): number => 100 * Math.pow(2, st / 12);

const features = (f0: number, rolloff: number): EffortFeatures => {
  const result = extractEffortFeatures(tone(f0, rolloff), SAMPLE_RATE);
  if (!result) throw new Error('expected features');
  return result;
};

describe('extractEffortFeatures', () => {
  it.each([110, 220, 440])('finds a %d Hz pitch', (f0) => {
    const hz = semitonesToHz(features(f0, 1.5).f0MedianSt);
    expect(Math.abs(hz - f0) / f0).toBeLessThan(0.05);
  });

  it('reads a flatter spectrum as brighter', () => {
    expect(features(200, 0.7).brightnessDb).toBeGreaterThan(features(200, 2).brightnessDb + 3);
  });

  it('is unaffected by level', () => {
    const quiet = tone(200, 1.5).map((s) => Math.round(s / 3));
    const loud = extractEffortFeatures(tone(200, 1.5), SAMPLE_RATE)!;
    const soft = extractEffortFeatures(quiet, SAMPLE_RATE)!;
    expect(soft.brightnessDb).toBeCloseTo(loud.brightnessDb, 1);
    expect(soft.f0MedianSt).toBeCloseTo(loud.f0MedianSt, 1);
  });

  it('returns null for silence and for clips too short to judge', () => {
    expect(extractEffortFeatures(new Int16Array(SAMPLE_RATE), SAMPLE_RATE)).toBeNull();
    expect(extractEffortFeatures(tone(200, 1.5, 0.02), SAMPLE_RATE)).toBeNull();
  });
});

describe('speaker baseline', () => {
  const calm = [118, 120, 122, 119, 121, 120, 123, 117].map((f0) => features(f0, 2));

  it('scores a raised, bright clip far above the speaker and a calm one near zero', () => {
    const baseline = buildSpeakerBaseline(calm)!;
    const shouted = effortZScores(features(260, 0.8), baseline);
    const ordinary = effortZScores(features(121, 2), baseline);

    expect(shouted.f0Median).toBeGreaterThan(3);
    expect(shouted.brightness).toBeGreaterThan(3);
    expect(Math.abs(ordinary.f0Median)).toBeLessThan(1);
    expect(Math.abs(ordinary.brightness)).toBeLessThan(1);
  });

  it('is not pulled up by the shouted clips it is meant to find', () => {
    const withOutliers = buildSpeakerBaseline([...calm, features(300, 0.8), features(320, 0.8)])!;
    expect(semitonesToHz(withOutliers.f0MedianSt.median)).toBeLessThan(130);
  });

  it('has no baseline without clips', () => {
    expect(buildSpeakerBaseline([])).toBeNull();
  });
});

describe('decideVocalEffort', () => {
  it('leaves ordinary dialogue untagged', () => {
    expect(decideVocalEffort({ sourceText: 'Nice weather today.' }).tag).toBeNull();
    expect(decideVocalEffort({ sourceText: 'Thanks!' }).tag).toBeNull();
  });

  it('tags combat barks as shouting', () => {
    expect(decideVocalEffort({ combatBark: true, sourceText: 'Get down!' }).tag).toBe('shouting');
  });

  it('follows the actor direction', () => {
    expect(decideVocalEffort({ scriptNote: 'Shouting over gunfire' }).tag).toBe('shouting');
    expect(decideVocalEffort({ scriptNote: 'thoughtful, quiet' }).tag).toBeNull();
  });

  it('tags on acoustics alone when the clip stands far out', () => {
    const acoustic = { f0Median: 3, f0P90: 3, brightness: 2.5 };
    expect(decideVocalEffort({ acoustic, sourceText: 'I said no.' }).tag).toBe('shouting');
  });

  it('does not tag on pitch alone', () => {
    const acoustic = { f0Median: 2, f0P90: 2, brightness: -0.5 };
    expect(decideVocalEffort({ acoustic }).tag).toBeNull();
  });

  it('screams only with fear or pain behind a high score', () => {
    const acoustic = { f0Median: 4, f0P90: 4, brightness: 3 };
    expect(decideVocalEffort({ acoustic, combatBark: true, emotion: 'fear' }).tag).toBe(
      'screaming',
    );
    expect(decideVocalEffort({ acoustic, combatBark: true, emotion: 'anger' }).tag).toBe(
      'shouting',
    );
  });
});

describe('applyEffortTag', () => {
  it('prefixes the tag and leaves untagged text alone', () => {
    expect(applyEffortTag(' Лягай! ', 'shouting')).toBe('[shouting] Лягай!');
    expect(applyEffortTag('Привіт.', null)).toBe('Привіт.');
  });
});
