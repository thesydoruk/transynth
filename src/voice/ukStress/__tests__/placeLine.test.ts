import { mergeLlmWordStress, placeLineWithDictionary, restoreWordCase } from '../placeLine';
import type { UkStressDictionary } from '../dictionary';

const mockDict = (
  entries: Record<string, { stress: number; type: 'unique' | 'variative' | 'heteronym' }>,
): UkStressDictionary => ({
  lookupFull: (word) => {
    const hit = entries[word.toLocaleLowerCase('uk-UA')];
    if (!hit) return null;
    return { stress: hit.stress, type: hit.type };
  },
});

describe('restoreWordCase', () => {
  it('keeps lowercase', () => {
    expect(restoreWordCase('можу', 'мо\u0301жу')).toBe('мо\u0301жу');
  });

  it('restores title case', () => {
    expect(restoreWordCase('Можу', 'мо\u0301жу')).toBe('Мо\u0301жу');
  });
});

describe('placeLineWithDictionary', () => {
  const dict = mockDict({
    можу: { stress: 0, type: 'unique' },
    було: { stress: 1, type: 'unique' },
    замок: { stress: 0, type: 'heteronym' },
    помилка: { stress: 0, type: 'variative' },
  });

  it('marks unique and variative words; leaves heteronym/OOV for LLM', () => {
    const placed = placeLineWithDictionary(dict, 'Я можу. Це було замок і індексатор, помилка.');
    expect(placed.partialStressed).toContain('мо\u0301жу');
    expect(placed.partialStressed).toContain('було\u0301');
    expect(placed.partialStressed).toContain('по\u0301милка');
    expect(placed.partialStressed).toContain('замок');
    expect(placed.partialStressed).toContain('індексатор');
    expect(placed.unresolved.map((u) => u.word).sort()).toEqual(['замок', 'індексатор']);
  });

  it('preserves punctuation and stage directions', () => {
    const placed = placeLineWithDictionary(dict, '*важке* Можу...');
    expect(placed.partialStressed.startsWith('*важке*')).toBe(true);
    expect(placed.partialStressed).toContain('Мо\u0301жу');
  });

  it('preserves source apostrophe characters', () => {
    const word = '\u043F\u0430\u043C\u0027\u044F\u0442\u0456'; // пам'яті
    const dictAp = mockDict({ [word]: { stress: 0, type: 'unique' } });
    const placed = placeLineWithDictionary(
      dictAp,
      `\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 ${word}`,
    );
    expect(placed.partialStressed).toBe(
      `\u041F\u0435\u0440\u0435\u0432\u0456\u0440\u043A\u0430 \u043F\u0430\u0301\u043C\u0027\u044F\u0442\u0456`,
    );
  });
});

describe('mergeLlmWordStress', () => {
  it('replaces only requested token indices', () => {
    const partial = 'Він відчинив замок на дверях.';
    const merged = mergeLlmWordStress(partial, new Map([[2, 'замо\u0301к']]));
    expect(merged).toBe('Він відчинив замо\u0301к на дверях.');
  });

  it('rejects letter drift from LLM', () => {
    const partial = 'Він відчинив замок.';
    const merged = mergeLlmWordStress(partial, new Map([[2, 'замо\u0301чок']]));
    expect(merged).toBe(partial);
  });
});
