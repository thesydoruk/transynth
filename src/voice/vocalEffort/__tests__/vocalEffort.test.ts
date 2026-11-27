import { buildSpeakerBaseline, effortZScores } from '../baseline';
import { applyEffortTag, decideVocalEffort, hasEffortCue } from '../decide';
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

  it('does not hear hiss between the words as brightness', () => {
    const voiced = tone(200, 2);
    // A sibilant: loud white noise, far brighter than the voice around it.
    let seed = 12345;
    const hiss = new Int16Array(SAMPLE_RATE / 2).map(() => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.round((seed / 2147483648 - 0.5) * 16000);
    });
    const withHiss = new Int16Array([...voiced, ...hiss, ...voiced]);

    const clean = extractEffortFeatures(voiced, SAMPLE_RATE)!;
    const hissed = extractEffortFeatures(withHiss, SAMPLE_RATE)!;
    expect(hissed.voicedRatio).toBeLessThan(0.9);
    // The frames straddling voice and hiss still count; over every frame the gap is ~15 dB.
    expect(Math.abs(hissed.brightnessDb - clean.brightnessDb)).toBeLessThan(2);
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

  it('needs the calm clips of a speaker who mostly shouts', () => {
    const shouts = [300, 310, 320, 305, 315, 325, 295, 330, 312, 318].map((f0) =>
      features(f0, 0.8),
    );
    const shouted = features(310, 0.8);

    const fromEverything = effortZScores(shouted, buildSpeakerBaseline([...calm, ...shouts])!);
    const fromCalm = effortZScores(shouted, buildSpeakerBaseline(calm)!);
    expect(fromEverything.f0Median).toBeLessThan(1);
    expect(fromCalm.f0Median).toBeGreaterThan(3);
  });

  it('has no baseline without clips', () => {
    expect(buildSpeakerBaseline([])).toBeNull();
  });
});

describe('decideVocalEffort', () => {
  const pushed = { f0Median: 3, brightness: 2.2 };
  const calm = { f0Median: 0.3, brightness: -0.2 };

  it('tags a pushed clip whose line says it is shouted', () => {
    expect(decideVocalEffort({ acoustic: pushed, sourceText: 'Get down!' }).tag).toBe('shouting');
    expect(
      decideVocalEffort({ acoustic: pushed, sourceText: 'Go.', scriptNote: 'Yelling to allies' })
        .tag,
    ).toBe('shouting');
  });

  it('does not take the text at its word when the clip is calm', () => {
    expect(decideVocalEffort({ acoustic: calm, sourceText: 'Thanks!' }).tag).toBeNull();
    expect(
      decideVocalEffort({ acoustic: calm, scriptNote: 'Shouting over gunfire' }).tag,
    ).toBeNull();
  });

  it('never tags a line it has no clip for', () => {
    const decision = decideVocalEffort({ sourceText: 'Get down!' });
    expect(decision).toEqual({ strength: null, cued: true, tag: null });
  });

  it('calls a pushed clip without a cue loud, and only from a higher strength', () => {
    expect(decideVocalEffort({ acoustic: pushed, sourceText: 'I said no.' }).tag).toBeNull();
    const harder = { f0Median: 3.4, brightness: 2.6 };
    expect(decideVocalEffort({ acoustic: harder, sourceText: 'I said no.' }).tag).toBe('loud');
  });

  it('needs pitch and brightness together', () => {
    const highOnly = { f0Median: 5.7, brightness: 0.1 };
    const brightOnly = { f0Median: 0.2, brightness: 4.9 };
    expect(decideVocalEffort({ acoustic: highOnly, sourceText: 'Hear me?!' }).tag).toBeNull();
    expect(decideVocalEffort({ acoustic: brightOnly, sourceText: 'Shit!' }).tag).toBeNull();
    expect(decideVocalEffort({ acoustic: highOnly }).strength).toBeCloseTo(0.1);
  });
});

describe('hasEffortCue', () => {
  it('hears a cue in the text or in the actor note', () => {
    expect(hasEffortCue({ sourceText: 'Everybody up! We got trouble!' })).toBe(true);
    expect(hasEffortCue({ sourceText: 'Hurry.', scriptNote: 'quick shout as you flee' })).toBe(
      true,
    );
    expect(hasEffortCue({ sourceText: 'Nice weather.', scriptNote: 'friendly' })).toBe(false);
  });
});

describe('applyEffortTag', () => {
  it('prefixes the tag and leaves untagged text alone', () => {
    expect(applyEffortTag(' Лягай! ', 'shouting')).toBe('[shouting] Лягай!');
    expect(applyEffortTag('Привіт.', null)).toBe('Привіт.');
  });
});
