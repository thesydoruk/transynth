import { describe, expect, it } from '@jest/globals';
import { createNameMatcher } from '../names';
import type { ReviewLine, ReviewUnit } from '../types';

const canon = {
  names: {
    Hancock: 'Генкок',
    'Faneuil Hall': 'Фейніл-Голл',
    'D.B. Technical High School': 'Технічна школа Д.Б.',
    "Drinkin' Buddy": 'Пивний товариш',
    Don: 'Дон',
    Synth: 'синт',
  },
  generic: ['Don'],
};

const units = (...lines: Partial<ReviewLine>[]): ReviewUnit[] => [
  {
    unit_id: 'u',
    kind: 'group',
    lines: lines.map((l, i) => ({ id: i + 1, kind: 'response', src: '', tr: '', ...l })),
  },
];

describe('createNameMatcher', () => {
  const match = createNameMatcher(canon);

  it('finds names with possessives and plurals', () => {
    expect(match(units({ src: "Hancock's men took Faneuil Hall. Synths everywhere." }))).toEqual({
      'Faneuil Hall': 'Фейніл-Голл',
      Hancock: 'Генкок',
      Synth: 'синт',
    });
  });

  it('matches names that start with initials or end in an apostrophe', () => {
    expect(
      match(units({ src: "Meet me at D.B. Technical High School with Drinkin' Buddy." })),
    ).toEqual({
      'D.B. Technical High School': 'Технічна школа Д.Б.',
      "Drinkin' Buddy": 'Пивний товариш',
    });
  });

  it('skips ordinary words and parts of other words', () => {
    expect(match(units({ src: "Don't go. No — Hancocking around." }))).toEqual({});
  });

  it('leaves out a name the batch itself defines', () => {
    expect(
      match(units({ src: 'Hancock', sig: 'NPC_', field: 'FULL' }, { src: 'Ask Hancock.' })),
    ).toEqual({});
  });

  it('returns nothing without a canon', () => {
    expect(createNameMatcher(undefined)(units({ src: 'Hancock' }))).toEqual({});
  });
});
