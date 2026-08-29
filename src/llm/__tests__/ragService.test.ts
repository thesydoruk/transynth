import { buildEmbeddingInput, isStaleTranslationRagSyncError } from '../rag';
import { clampRagMaxExamples, RAG_EXAMPLE_MAX_CHARS, RAG_MAX_EXAMPLES } from '../ragConstants';

describe('buildEmbeddingInput', () => {
  it('includes signature, path, context, and source text', () => {
    const input = buildEmbeddingInput({
      sourceText: 'Hello world',
      signature: 'INFO',
      path: 'INFO\\NAM1',
      context: 'Travis',
    });
    expect(input).toContain('signature: INFO');
    expect(input).toContain('path: INFO\\NAM1');
    expect(input).toContain('context: Travis');
    expect(input).toContain('source: Hello world');
  });

  it('omits null metadata fields', () => {
    expect(buildEmbeddingInput({ sourceText: 'Only source' })).toBe('source: Only source');
  });
});

describe('isStaleTranslationRagSyncError', () => {
  it('detects missing translation FK violations', () => {
    expect(isStaleTranslationRagSyncError({ code: '23503' })).toBe(true);
    expect(isStaleTranslationRagSyncError(new Error('other'))).toBe(false);
  });
});

describe('clampRagMaxExamples', () => {
  it('clamps to 1…RAG_MAX_EXAMPLES', () => {
    expect(clampRagMaxExamples()).toBe(5);
    expect(clampRagMaxExamples(10)).toBe(10);
    expect(clampRagMaxExamples(15)).toBe(RAG_MAX_EXAMPLES);
    expect(clampRagMaxExamples(0)).toBe(1);
    expect(clampRagMaxExamples(-3)).toBe(1);
  });
});

describe('RAG_EXAMPLE_MAX_CHARS', () => {
  it('truncates long example text in retrieval output', () => {
    const long = 'a'.repeat(RAG_EXAMPLE_MAX_CHARS + 10);
    const truncated =
      long.length <= RAG_EXAMPLE_MAX_CHARS ? long : `${long.slice(0, RAG_EXAMPLE_MAX_CHARS - 1)}…`;
    expect(truncated.length).toBe(RAG_EXAMPLE_MAX_CHARS);
    expect(truncated.endsWith('…')).toBe(true);
  });
});
