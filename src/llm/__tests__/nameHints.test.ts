import { describe, expect, it } from '@jest/globals';
import '../../games/registerForTests';
import {
  NAME_HINT_LIMIT,
  nameHintsForGame,
  nameHintsFromCanon,
  selectGlossaryWithNameHints,
} from '../nameHints';
import { selectGlossaryByWordBoundary } from '../glossarySelect';
import type { LlmGlossaryEntry } from '../translate';

const canon = {
  names: {
    'Skinny Malone': 'Скінні Малоун',
    'Faneuil Hall': 'Фейніл-Голл',
    Nucleus: 'Нуклеус',
    Don: 'Дон',
    Sturges: 'Стерджес',
    'Clean up various parts of the Open Season quest once done.': 'Прибирання…',
    'P.A.M.': 'P.A.M.',
  },
  generic: ['Don'],
};

// Word-boundary selection only, and a record of what it was given.
const recordingSelect = () => {
  const seen: LlmGlossaryEntry[][] = [];
  const select = async (entries: readonly LlmGlossaryEntry[], texts: readonly string[]) => {
    seen.push([...entries]);
    return selectGlossaryByWordBoundary(entries, texts);
  };
  return { seen, select };
};

describe('nameHintsFromCanon', () => {
  it('keeps names the glossary lacks, and drops ordinary words, sentences and untranslated names', () => {
    const hints = nameHintsFromCanon(canon, [{ term: 'sturges' }]);

    expect(hints.map((h) => h.term)).toEqual(['Skinny Malone', 'Faneuil Hall', 'Nucleus']);
    expect(hints.every((h) => h.nameHint)).toBe(true);
  });
});

describe('nameHintsForGame', () => {
  it('serves the Fallout 4 canon for English → Ukrainian only', () => {
    expect(nameHintsForGame('fo4', 'en', 'uk', []).length).toBeGreaterThan(1000);
    expect(nameHintsForGame('fo4', 'en', 'de', [])).toEqual([]);
    expect(nameHintsForGame('sse', 'en', 'uk', [])).toEqual([]);
  });
});

describe('selectGlossaryWithNameHints', () => {
  const glossary: LlmGlossaryEntry[] = [{ term: 'Diamond City', translation: 'Даймонд-сіті' }];
  const all = [...glossary, ...nameHintsFromCanon(canon, glossary)];

  it('adds the names the source mentions after the glossary terms', async () => {
    const { select } = recordingSelect();

    const out = await selectGlossaryWithNameHints(
      all,
      ['Skinny Malone wants you in Diamond City.'],
      select,
    );

    expect(out).toEqual([
      { term: 'Diamond City', translation: 'Даймонд-сіті' },
      { term: 'Skinny Malone', translation: 'Скінні Малоун' },
    ]);
  });

  it('never hands names to the term selection, so they are not embedded', async () => {
    const { seen, select } = recordingSelect();

    await selectGlossaryWithNameHints(all, ['Nucleus'], select);

    expect(seen).toEqual([glossary]);
  });

  it('caps the names per request', async () => {
    const many = Array.from({ length: NAME_HINT_LIMIT + 5 }, (_, i) => ({
      term: `Name${i}`,
      translation: `Імʼя${i}`,
      nameHint: true as const,
    }));
    const { select } = recordingSelect();

    const out = await selectGlossaryWithNameHints(
      many,
      [many.map((m) => m.term).join(' ')],
      select,
    );

    expect(out).toHaveLength(NAME_HINT_LIMIT);
  });
});
