import { describe, it, expect } from '@jest/globals';
import type { SpeakerGender } from '../../dialog/gender';
import { findUkrainianGenderConflicts } from '../../dialog/ukrainianGender';
import { UK_GENDER_AGREEMENT_EXAMPLES, UK_GENDER_REPAIR_EXAMPLES } from '../genderRepair';
import { UK_GENDER_RECAST_ITEMS } from '../prompts/genderRules';

/** The player picks their own character, so neither role may be pinned down. */
const PLAYER_LINE = { speakerGender: 'any', addresseeGender: 'any' } as const;

const conflicts = (text: string) =>
  findUkrainianGenderConflicts(text, PLAYER_LINE).map((conflict) => conflict.form);

describe('gender repair examples', () => {
  it('teaches from more than a handful of cases', () => {
    expect(UK_GENDER_REPAIR_EXAMPLES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(UK_GENDER_REPAIR_EXAMPLES.map((example) => [example.source, example] as const))(
    'leaks before and not after: %s',
    (_source, example) => {
      // A worked repair is only worth showing if it repairs something.
      expect(conflicts(example.leaking).length).toBeGreaterThan(0);
      // And the answer must survive the detector that rejected the draft, or the
      // example teaches the model that leaving a marker standing is acceptable.
      expect(conflicts(example.repaired)).toEqual([]);
    },
  );

  it('names the offending form in every problem note', () => {
    for (const example of UK_GENDER_REPAIR_EXAMPLES) {
      const forms = conflicts(example.leaking);
      const named = forms.some((form) => example.problem.includes(form));
      expect({ source: example.source, named }).toEqual({ source: example.source, named: true });
    }
  });

  it('never simply swaps one gender for the other', () => {
    for (const example of UK_GENDER_REPAIR_EXAMPLES) {
      expect(example.repaired).not.toBe(example.leaking);
      expect(example.repaired).not.toMatch(/\w+\/\w+/u);
    }
  });

  it('shows a different construction each time, not one trick repeated', () => {
    const answers = UK_GENDER_REPAIR_EXAMPLES.map((example) => example.repaired);
    expect(new Set(answers).size).toBe(answers.length);
  });
});

type RecastItem = {
  source: string;
  translation: string;
  bad?: string[];
  speaker_gender?: string;
  addressee_gender?: string;
};

describe('gender recast examples', () => {
  const items = UK_GENDER_RECAST_ITEMS as readonly RecastItem[];

  it.each(items.map((item) => [item.source, item] as const))(
    'shows an answer the detector accepts: %s',
    (_source, item) => {
      const leaks = findUkrainianGenderConflicts(item.translation, {
        speakerGender: (item.speaker_gender ?? 'unknown') as never,
        addresseeGender: (item.addressee_gender ?? 'unknown') as never,
      });
      expect(leaks.map((leak) => leak.form)).toEqual([]);
    },
  );

  it('never answers with a slash or two genders in a row', () => {
    for (const item of items) {
      expect(item.translation).not.toMatch(/\w+\/\w+/u);
    }
  });

  it('keeps the answers distinct, so each teaches its own construction', () => {
    const answers = items.map((item) => item.translation);
    expect(new Set(answers).size).toBe(answers.length);
  });
});

describe('gender agreement examples', () => {
  it.each(UK_GENDER_AGREEMENT_EXAMPLES.map((example) => [example.source, example] as const))(
    'agrees rather than conceals: %s',
    (_source, example) => {
      // The problem note names the gender the answer has to take.
      const wanted = example.problem.includes('жіночий') ? 'female' : 'male';
      const other = wanted === 'female' ? 'male' : 'female';
      const role = example.problem.includes('мовець') ? 'speaker' : 'addressee';
      const participants = {
        speakerGender: (role === 'speaker' ? wanted : 'unknown') as SpeakerGender,
        addresseeGender: (role === 'addressee' ? wanted : 'unknown') as SpeakerGender,
      };

      // The draft disagrees with the participant, the answer agrees with them.
      expect(findUkrainianGenderConflicts(example.leaking, participants).length).toBeGreaterThan(0);
      expect(findUkrainianGenderConflicts(example.repaired, participants)).toEqual([]);

      // And it commits to that gender rather than hiding it, which is the whole
      // point of this branch: the answer must read wrong for the other gender.
      const flipped = {
        speakerGender: (role === 'speaker' ? other : 'unknown') as SpeakerGender,
        addresseeGender: (role === 'addressee' ? other : 'unknown') as SpeakerGender,
      };
      expect(findUkrainianGenderConflicts(example.repaired, flipped).length).toBeGreaterThan(0);
    },
  );

  it('changes the ending, not the sentence', () => {
    for (const example of UK_GENDER_AGREEMENT_EXAMPLES) {
      const words = (text: string) => text.split(/\s+/u).length;
      expect(words(example.repaired)).toBe(words(example.leaking));
    }
  });
});
