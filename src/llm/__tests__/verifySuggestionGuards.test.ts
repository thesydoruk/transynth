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

  it('rejects barrel suggestion using "Стіл"', () => {
    const item: LlmVerifyItem = {
      id: 2,
      source: 'Tesla Cannon Tesla Beaton Barrel',
      translation: 'Стівол Тесла-Бітон для гармати Тесли',
      grup: 'OMOD',
      field: 'FULL',
      edid: 'mod_TesCan_Barrel_TeslaBeaton',
      context: null,
    };
    const result = validateVerifySuggestion(item, 'Стіл Тесла-Бітон для гармати Тесли', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_term');
  });

  it('rejects damage terminology swap from шкода to урон', () => {
    const item: LlmVerifyItem = {
      id: 3,
      source: 'Improved damage.',
      translation: 'Покращена шкода.',
      grup: 'OMOD',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const result = validateVerifySuggestion(item, 'Покращений урон.', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('terminology_swap');
  });

  it('rejects verbose FMRN expansion', () => {
    const item: LlmVerifyItem = {
      id: 4,
      source: 'Mouth Main',
      translation: 'Рот',
      grup: 'RACE',
      field: 'FMRN',
      edid: 'Morph',
      context: null,
    };
    const result = validateVerifySuggestion(item, 'Основна частина рота', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('oververbose');
  });

  it('rejects Latin tokens absent from source', () => {
    const item: LlmVerifyItem = {
      id: 5,
      source: 'Pipboy Cloak',
      translation: 'Плащ Піп-боя',
      grup: 'ARMO',
      field: 'FULL',
      edid: 'PipboyPickUpCloak',
      context: null,
    };
    const result = validateVerifySuggestion(item, 'Плащ Піп-боя (PickUp)', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('introduced_latin');
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

  it('strips invalid barrel suggestion and keeps suspicious row approved', () => {
    const item: LlmVerifyItem = {
      id: 2,
      source: 'Tesla Cannon Tesla Beaton Barrel',
      translation: 'Стівол Тесла-Бітон для гармати Тесли',
      grup: 'OMOD',
      field: 'FULL',
      edid: 'mod_TesCan_Barrel_TeslaBeaton',
      context: null,
    };
    const sanitized = sanitizeVerifyResult(
      item,
      {
        id: item.id,
        verdict: 'suspicious',
        reason: 'Wrong barrel term.',
        confidence: 0.9,
        suggestion: 'Стіл Тесла-Бітон для гармати Тесли',
      },
      'fo4',
    );
    expect(sanitized.verdict).toBe('ok');
    expect(sanitized.suggestion).toBeNull();
    expect(sanitized.reason).toContain('Suggestion rejected');
  });
});
