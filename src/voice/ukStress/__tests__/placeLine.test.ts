import { mergeLlmWordStress, placeLineWithDictionary, restoreWordCase } from '../placeLine';
import type { UkStressDictionary } from '../dictionary';

const mockDict = (
  entries: Record<string, { mark: string; type: 'unique' | 'variative' | 'heteronym' }>,
): UkStressDictionary => ({
  lookupFull: (word) => {
    const hit = entries[word.toLocaleLowerCase('uk-UA')];
    if (!hit) return null;
    return { stress: 0, type: hit.type };
  },
  mark: (word) => {
    const hit = entries[word.toLocaleLowerCase('uk-UA')];
    if (!hit || hit.type === 'heteronym') return null;
    return hit.mark;
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
    можу: { mark: 'мо\u0301жу', type: 'unique' },
    було: { mark: 'було\u0301', type: 'unique' },
    замок: { mark: 'за\u0301мок', type: 'heteronym' },
    помилка: { mark: 'по\u0301милка', type: 'variative' },
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
