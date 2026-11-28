import type { EffortFeatures } from '../features';
import { MIN_TAGGING_BASELINE_CLIPS, planVocalEffort, type EffortClip } from '../plan';

const calmVoice = (i: number): EffortFeatures => ({
  f0MedianSt: 2 + (i % 5) * 0.4,
  brightnessDb: -9 + (i % 3) * 0.5,
  voicedRatio: 0.8,
});
const pushed: EffortFeatures = { f0MedianSt: 20, brightnessDb: -3, voicedRatio: 0.8 };

const clip = (key: string, over: Partial<EffortClip> = {}): EffortClip => ({
  key,
  speakerKey: 'RaiderMale01',
  features: calmVoice(0),
  calmTopic: true,
  speakable: true,
  sourceText: 'Nothing to see here.',
  actorNote: null,
  ...over,
});

/** A speaker with exactly enough calm lines for a baseline. */
const calmLines = (speakerKey = 'RaiderMale01', count = MIN_TAGGING_BASELINE_CLIPS): EffortClip[] =>
  Array.from({ length: count }, (_, i) =>
    clip(`${speakerKey}/calm-${i}`, { speakerKey, features: calmVoice(i) }),
  );

describe('planVocalEffort', () => {
  it('tags a pushed, cued line against the calm lines of its speaker', () => {
    const decisions = planVocalEffort([
      ...calmLines(),
      clip('shout', { features: pushed, calmTopic: false, sourceText: "I'm out!" }),
    ]);
    expect(decisions.get('shout')?.tag).toBe('shouting');
    expect(decisions.get('RaiderMale01/calm-0')?.tag).toBeNull();
  });

  it('keeps shouted, wordless and combat clips out of the baseline', () => {
    // Half the speaker's clips are shouts filed under calm topics, or noises.
    const loudCrowd = Array.from({ length: 40 }, (_, i) =>
      clip(`crowd-${i}`, { features: pushed, sourceText: 'Chop him into pieces!' }),
    );
    const noises = Array.from({ length: 40 }, (_, i) =>
      clip(`noise-${i}`, { features: pushed, speakable: false, sourceText: '*Whistling*' }),
    );
    const barks = Array.from({ length: 40 }, (_, i) =>
      clip(`bark-${i}`, { features: pushed, calmTopic: false, sourceText: 'Die.' }),
    );
    const decisions = planVocalEffort([...calmLines(), ...loudCrowd, ...noises, ...barks]);

    expect(decisions.get('crowd-0')?.tag).toBe('shouting');
    expect(decisions.get('bark-0')?.tag).toBe('loud');
    // A line with nothing to say is never synthesized, so it gets no decision.
    expect(decisions.has('noise-0')).toBe(false);
  });

  it('leaves a speaker with too few calm lines untagged', () => {
    const decisions = planVocalEffort([
      ...calmLines('RaiderMale01'),
      ...calmLines('Stranger', MIN_TAGGING_BASELINE_CLIPS - 1),
      clip('stranger-shout', { speakerKey: 'Stranger', features: pushed, sourceText: 'Run!' }),
    ]);
    expect(decisions.has('stranger-shout')).toBe(false);
    expect(decisions.has('Stranger/calm-0')).toBe(false);
  });

  it('decides nothing for a clip that could not be measured', () => {
    const decisions = planVocalEffort([
      ...calmLines(),
      clip('quiet', { features: null, sourceText: 'Run!' }),
    ]);
    expect(decisions.has('quiet')).toBe(false);
  });
});
