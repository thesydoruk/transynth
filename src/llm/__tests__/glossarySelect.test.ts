import { describe, expect, it, beforeEach } from '@jest/globals';
import {
  GLOSSARY_EMBED_MIN_SIM,
  resetGlossaryEmbedCache,
  selectGlossaryByWordBoundary,
  selectRelevantGlossary,
} from '../glossarySelect';

const glossary = [
  { term: 'Institute', translation: 'Інститут' },
  { term: 'Pip-Boy', translation: 'Піп-бой' },
  { term: 'synth', translation: 'синт' },
  { term: 'Addictol', translation: 'Аддиктол' },
];

describe('selectGlossaryByWordBoundary', () => {
  it('keeps terms that appear in source', () => {
    expect(selectGlossaryByWordBoundary(glossary, ['The Institute sent a Courser.'])).toEqual([
      { term: 'Institute', translation: 'Інститут' },
    ]);
  });

  it('skips terms that are only semantically nearby', () => {
    expect(selectGlossaryByWordBoundary(glossary, ['The weather looks fine.'])).toEqual([]);
  });
});

describe('selectRelevantGlossary', () => {
  beforeEach(() => {
    resetGlossaryEmbedCache();
  });

  it('adds embedding neighbors that the regex missed', async () => {
    const termVecs: Record<string, number[]> = {
      Institute: [1, 0],
      'Pip-Boy': [0, 1],
      synth: [0.95, 0.1],
      Addictol: [0, 1],
    };
    const selected = await selectRelevantGlossary(glossary, ['The Institute sent a Courser.'], {
      embedTexts: async (texts) =>
        texts.map((text) => {
          if (text.includes('Institute sent')) return [1, 0];
          return termVecs[text] ?? [0, 0];
        }),
    });
    expect(selected.map((row) => row.term)).toEqual(['Institute', 'synth']);
  });

  it('falls back to word-boundary hits when embed fails', async () => {
    const selected = await selectRelevantGlossary(glossary, ['Check the Pip-Boy map.'], {
      embedTexts: async () => {
        throw new Error('embed down');
      },
    });
    expect(selected).toEqual([{ term: 'Pip-Boy', translation: 'Піп-бой' }]);
  });

  it('does not fill below the similarity floor', async () => {
    const selected = await selectRelevantGlossary(glossary, ['The Institute sent a Courser.'], {
      embedTexts: async (texts) =>
        texts.map((text) => (text.includes('Institute sent') ? [1, 0] : [0, 1])),
    });
    expect(selected.map((row) => row.term)).toEqual(['Institute']);
    expect(GLOSSARY_EMBED_MIN_SIM).toBeGreaterThan(0);
  });
});
