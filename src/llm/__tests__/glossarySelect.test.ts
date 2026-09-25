import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import {
  GLOSSARY_EMBED_MIN_SIM,
  GLOSSARY_EMBED_RETRY_AFTER_MS,
  GLOSSARY_TERM_EMBED_BATCH,
  embedTermsInBatches,
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

  it('embeds a large glossary in batches instead of one request', async () => {
    const big = Array.from({ length: GLOSSARY_TERM_EMBED_BATCH * 2 + 5 }, (_, i) => ({
      term: `Term${i}`,
      translation: `Термін${i}`,
    }));
    const sizes: number[] = [];
    await selectRelevantGlossary(big, ['Nothing from the glossary here.'], {
      embedTexts: async (texts) => {
        sizes.push(texts.length);
        return texts.map(() => [1, 0]);
      },
    });
    // Three term batches, then the query on its own.
    expect(sizes).toEqual([GLOSSARY_TERM_EMBED_BATCH, GLOSSARY_TERM_EMBED_BATCH, 5, 1]);
  });

  it('remembers a failed build and does not ask again on the next chunk', async () => {
    const embedTexts = jest.fn<(texts: string[]) => Promise<number[][]>>(async () => {
      throw new Error('embed down');
    });
    let clock = 1_000;
    const deps = { embedTexts, now: () => clock };
    await selectRelevantGlossary(glossary, ['Check the Pip-Boy map.'], deps);
    await selectRelevantGlossary(glossary, ['Another chunk of text.'], deps);
    expect(embedTexts).toHaveBeenCalledTimes(1);

    clock += GLOSSARY_EMBED_RETRY_AFTER_MS + 1;
    await selectRelevantGlossary(glossary, ['A chunk after the retry window.'], deps);
    expect(embedTexts).toHaveBeenCalledTimes(2);
  });

  it('shares one build between concurrent chunks', async () => {
    const embedTexts = jest.fn<(texts: string[]) => Promise<number[][]>>(async (texts) => {
      await new Promise((r) => setTimeout(r, 10));
      return texts.map(() => [1, 0]);
    });
    await Promise.all([
      selectRelevantGlossary(glossary, ['first chunk'], { embedTexts }),
      selectRelevantGlossary(glossary, ['second chunk'], { embedTexts }),
    ]);
    // One call for the terms, one per query.
    expect(embedTexts).toHaveBeenCalledTimes(3);
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

describe('embedTermsInBatches', () => {
  it('halves a batch the server refuses as too large', async () => {
    const sizes: number[] = [];
    const vectors = await embedTermsInBatches(
      ['a', 'b', 'c', 'd'],
      async (texts) => {
        sizes.push(texts.length);
        if (texts.length > 2) throw new Error('413 status code (no body)');
        return texts.map((text) => [text.charCodeAt(0)]);
      },
      4,
    );
    expect(sizes).toEqual([4, 2, 2]);
    expect(vectors).toEqual([[97], [98], [99], [100]]);
  });

  it('rethrows an error that is not about payload size', async () => {
    await expect(
      embedTermsInBatches(['a', 'b'], async () => {
        throw new Error('connection refused');
      }),
    ).rejects.toThrow('connection refused');
  });
});
