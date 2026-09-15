import { describe, expect, it } from '@jest/globals';
import { mergeGenderRepair } from '../genderRepair';
import type { LlmTranslateOptions, LlmTranslateResult } from '../translate';

type Item = LlmTranslateOptions['items'][number];

const item = (id: number, source: string): Item => ({ id, source, speaker_gender: 'any' }) as Item;

const target = (id: number, source: string, draft: string) => ({
  kind: 'speaker' as const,
  item: item(id, source),
  draft,
  problem: 'stub',
});

const draftOf = (rows: Array<[number, string]>): LlmTranslateResult[] =>
  rows.map(([id, translation]) => ({ id, translation }));

describe('mergeGenderRepair', () => {
  it('takes a repair that removed the leak', () => {
    const draft = draftOf([[1, 'Я подбав про них.']]);
    const targets = [target(1, 'I took care of them.', 'Я подбав про них.')];
    const merged = mergeGenderRepair(draft, targets, new Map([[1, 'Про них подбали.']]), 'uk');
    expect(merged).toEqual([{ id: 1, translation: 'Про них подбали.' }]);
  });

  it('keeps the draft when the repair still leaks', () => {
    const draft = draftOf([[1, 'Я подбав про них.']]);
    const targets = [target(1, 'I took care of them.', 'Я подбав про них.')];
    // Swapping the gender is exactly what the repair prompt forbids.
    const merged = mergeGenderRepair(draft, targets, new Map([[1, 'Я подбала про них.']]), 'uk');
    expect(merged).toEqual(draft);
  });

  it('leaves rows the repair pass never looked at', () => {
    const draft = draftOf([
      [1, 'Я подбав про них.'],
      [2, 'Стимпак'],
    ]);
    const targets = [target(1, 'I took care of them.', 'Я подбав про них.')];
    const merged = mergeGenderRepair(draft, targets, new Map([[1, 'Про них подбали.']]), 'uk');
    expect(merged[1]).toEqual({ id: 2, translation: 'Стимпак' });
  });

  it('ignores a repair for an id that was never a target', () => {
    const draft = draftOf([[7, 'Я подбав про них.']]);
    const merged = mergeGenderRepair(draft, [], new Map([[7, 'Про них подбали.']]), 'uk');
    expect(merged).toEqual(draft);
  });

  it('is a no-op when the model echoed the draft back', () => {
    const draft = draftOf([[1, 'Я подбав про них.']]);
    const targets = [target(1, 'I took care of them.', 'Я подбав про них.')];
    const merged = mergeGenderRepair(draft, targets, new Map([[1, 'Я подбав про них.']]), 'uk');
    expect(merged).toEqual(draft);
  });
});
