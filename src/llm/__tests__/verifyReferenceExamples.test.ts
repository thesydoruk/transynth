import { describe, it, expect } from '@jest/globals';
import { filterVerifyReferenceExamples } from '../verifyReferenceExamples';
import type { LlmReferenceExample } from '../translate';

describe('filterVerifyReferenceExamples fallback', () => {
  it('falls back to same grup when field differs', () => {
    const examples: LlmReferenceExample[] = [
      {
        source: 'A',
        translation: 'B',
        grup: 'ARMO',
        edid: 'x',
        field: 'DESC',
        match_method: 'embed',
        similarity: 0.8,
      },
    ];
    const filtered = filterVerifyReferenceExamples(examples, {
      grup: 'ARMO',
      field: 'FULL',
      source: 'A',
    });
    expect(filtered).toHaveLength(1);
  });

  it('prefers numeric series templates over embedding matches', () => {
    const examples: LlmReferenceExample[] = [
      {
        source: 'Layer Handle - 0',
        translation: 'Обробник шару — 0',
        grup: 'ACTI',
        edid: 'Marker0',
        field: 'FULL',
        match_method: 'numeric',
        similarity: 0.95,
      },
      {
        source: 'Handle Grip',
        translation: 'Ручка захвату',
        grup: 'ACTI',
        edid: 'Other',
        field: 'FULL',
        match_method: 'embedding',
        similarity: 0.99,
      },
    ];

    const filtered = filterVerifyReferenceExamples(examples, {
      grup: 'ACTI',
      field: 'FULL',
      source: 'Layer Handle - 4',
    });

    expect(filtered?.[0]?.source).toBe('Layer Handle - 0');
    expect(filtered?.[0]?.match_method).toBe('numeric');
  });
});
