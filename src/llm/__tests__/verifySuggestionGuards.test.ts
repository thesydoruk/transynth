import { describe, it, expect } from '@jest/globals';
import { filterVerifyReferenceExamples } from '../verifyReferenceExamples';
import {
  reconcileVerifyResult,
  sanitizeVerifyResult,
  validateVerifySuggestion,
} from '../verifySuggestionGuards';
import type { LlmVerifyItem } from '../verifyTranslate';
import type { LlmReferenceExample } from '../translate';

describe('filterVerifyReferenceExamples', () => {
  const examples: LlmReferenceExample[] = [
    {
      source: 'A',
      translation: 'B',
      grup: 'ARMO',
      edid: 'x',
      field: 'FULL',
      match_method: 'exact',
      similarity: 1,
    },
    {
      source: 'C',
      translation: 'D',
      grup: 'INFO',
      edid: 'y',
      field: 'NAM1',
      match_method: 'embed',
      similarity: 0.9,
    },
  ];

  it('prefers same grup and field', () => {
    const filtered = filterVerifyReferenceExamples(examples, { grup: 'ARMO', field: 'FULL' });
    expect(filtered).toHaveLength(1);
    expect(filtered?.[0]?.grup).toBe('ARMO');
  });
});

describe('validateVerifySuggestion', () => {
  it('rejects token-breaking suggestions', () => {
    const item: LlmVerifyItem = {
      id: 1,
      source: 'You have %d caps',
      translation: 'У тебе %s кришок',
      grup: 'INFO',
      field: 'NAM1',
      edid: null,
      context: null,
    };
    const result = validateVerifySuggestion(item, 'У тебе %s кришок', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_mismatch');
  });
});

describe('reconcileVerifyResult', () => {
  it('downgrades suspicious when suggestion equals translation', () => {
    const item: LlmVerifyItem = {
      id: 1,
      source: 'Left Arm',
      translation: 'Ліва рука',
      grup: 'ARMO',
      field: 'FULL',
      edid: null,
      context: null,
    };
    const reconciled = reconcileVerifyResult(item, {
      id: 1,
      verdict: 'suspicious',
      reason: 'Style.',
      confidence: 0.9,
      suggestion: 'Ліва рука',
    });
    expect(reconciled.verdict).toBe('ok');
    expect(reconciled.suggestion).toBeNull();
  });

  it('keeps incorrect but drops noop suggestion', () => {
    const item: LlmVerifyItem = {
      id: 2,
      source: 'Nose Bridge',
      translation: 'Перенісся',
      grup: 'ARMO',
      field: 'FULL',
      edid: null,
      context: null,
    };
    const reconciled = reconcileVerifyResult(item, {
      id: 2,
      verdict: 'incorrect',
      reason: 'Homonym.',
      confidence: 0.95,
      suggestion: 'Перенісся',
    });
    expect(reconciled.verdict).toBe('incorrect');
    expect(reconciled.suggestion).toBeNull();
  });
});

describe('sanitizeVerifyResult', () => {
  it('approves suspicious row when suggestion breaks tokens but translation is fine', () => {
    const item: LlmVerifyItem = {
      id: 1,
      source: 'You have %d caps',
      translation: 'У тебе %d кришок',
      grup: 'INFO',
      field: 'NAM1',
      edid: null,
      context: null,
    };
    const sanitized = sanitizeVerifyResult(
      item,
      {
        id: item.id,
        verdict: 'suspicious',
        reason: 'Stylistic tweak.',
        confidence: 0.9,
        suggestion: 'У тебе %s кришок',
      },
      'fo4',
    );
    expect(sanitized.verdict).toBe('ok');
    expect(sanitized.suggestion).toBeNull();
  });
});
