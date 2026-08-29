import { tryParseLlmJson, trySalvageTruncatedTranslateJson } from '../jsonParse';

const buildVllmWrappedTranslate = (id: number, translation: string, closeOuter = true): string => {
  const inner = JSON.stringify({ items: [{ id, translation }] });
  const wrapped = JSON.stringify(inner);
  return closeOuter ? wrapped : wrapped.slice(0, -1);
};

describe('vLLM double-encoded translate responses', () => {
  it('parses a closed outer string wrapper', () => {
    const raw = buildVllmWrappedTranslate(2177256, 'Тест');
    expect(tryParseLlmJson(raw)).toEqual({ items: [{ id: 2177256, translation: 'Тест' }] });
  });

  it('recovers when the outer string wrapper is missing its closing quote', () => {
    const translation = `${'x'.repeat(8500)}історія».`;
    const raw = buildVllmWrappedTranslate(2177256, translation, false);

    const parsed = tryParseLlmJson(raw);
    const salvaged = trySalvageTruncatedTranslateJson(raw, 2177256);

    expect(parsed ?? salvaged).toEqual({
      items: [{ id: 2177256, translation }],
    });
  });
});
