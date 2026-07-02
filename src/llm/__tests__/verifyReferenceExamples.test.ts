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
    const filtered = filterVerifyReferenceExamples(examples, { grup: 'ARMO', field: 'FULL' });
    expect(filtered).toHaveLength(1);
  });
});
