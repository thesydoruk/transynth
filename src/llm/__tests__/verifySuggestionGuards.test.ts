import { describe, it, expect } from '@jest/globals';
import {
  isFullTranslationMismatch,
  reconcileVerifyResult,
  resolveVerifyFixAction,
  shouldRewriteFromSource,
  validateVerifySuggestion,
} from '../verifySuggestionGuards';
import type { LlmVerifyItem } from '../verifyTranslate';

describe('validateVerifySuggestion', () => {
  it('rejects suggestions that break protected tokens', () => {
    const item: LlmVerifyItem = {
      id: 1,
      source: 'You have %d caps',
      translation: 'У тебе %d кришок',
      grup: 'INFO',
      field: 'NAM1',
      edid: null,
      context: null,
    };
    const result = validateVerifySuggestion(item, 'У тебе %s кришок', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('token_mismatch');
  });

  it('rejects noop suggestions', () => {
    const item: LlmVerifyItem = {
      id: 2,
      source: 'Scrap ?',
      translation: 'Розібрати ?',
      grup: 'GMST',
      field: 'DATA',
      edid: null,
      context: null,
    };
    const result = validateVerifySuggestion(item, 'Розібрати ?', 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('noop');
  });
});

describe('resolveVerifyFixAction', () => {
  it('rejects token-breaking fixes for incorrect rows', () => {
    const item: LlmVerifyItem = {
      id: 6,
      source: 'Scrap %s?',
      translation: 'Розібрати?',
      grup: 'GMST',
      field: 'DATA',
      edid: 'sWorkshopScrapItemPrompt',
      context: null,
    };
    const action = resolveVerifyFixAction(item, 'incorrect', 'Розібрати?', false, 'fo4');
    expect(action.kind).toBe('reject_fix');
    if (action.kind === 'reject_fix') {
      expect(action.message).toMatch(/token/i);
    }
  });

  it('applies suspicious fixes only when fixSuspicious is enabled', () => {
    const item: LlmVerifyItem = {
      id: 7,
      source: 'Scrap ?',
      translation: 'Розібрати ?',
      grup: 'GMST',
      field: 'DATA',
      edid: 'sWorkshopScrapPrompt',
      context: null,
    };
    expect(resolveVerifyFixAction(item, 'suspicious', 'Розібрати?', false, 'fo4').kind).toBe(
      'flag_only',
    );
    expect(resolveVerifyFixAction(item, 'suspicious', 'Розібрати?', true, 'fo4').kind).toBe(
      'apply',
    );
  });

  it('applies incorrect fixes when tokens are preserved', () => {
    const item: LlmVerifyItem = {
      id: 8,
      source: 'Layer Handle - 4',
      translation: 'Ручка шару 4',
      grup: 'ACTI',
      field: 'FULL',
      edid: 'WSPlus_LayerHandleMarker_04',
      context: null,
    };
    const action = resolveVerifyFixAction(item, 'incorrect', 'Обробник шару — 4', true, 'fo4');
    expect(action.kind).toBe('apply');
  });

  it('rewrites from source on full mismatch with null suggestion', () => {
    const item: LlmVerifyItem = {
      id: 9,
      source: 'Controls',
      translation: 'Керування персонажем: [Activate] — взаємодія, [Click] — вибір у меню.',
      grup: 'MESG',
      field: 'ITXT',
      edid: 'HelpControls',
      context: null,
    };
    expect(isFullTranslationMismatch(item, 'fo4')).toBe(true);
    expect(shouldRewriteFromSource(item, 'incorrect', null, false, 'fo4')).toBe(true);
    expect(resolveVerifyFixAction(item, 'incorrect', null, false, 'fo4').kind).toBe(
      'rewrite_from_source',
    );
  });

  it('rewrites from source when suggestion copies alien tokens', () => {
    const item: LlmVerifyItem = {
      id: 10,
      source: 'Perks',
      translation: 'Перки: [Activate] відкриває меню, [Accept] підтверджує вибір.',
      grup: 'MESG',
      field: 'ITXT',
      edid: 'HelpPerks',
      context: null,
    };
    const badSuggestion = 'Перки: [Activate] відкриває меню, [Accept] підтверджує вибір.';
    expect(resolveVerifyFixAction(item, 'incorrect', badSuggestion, false, 'fo4').kind).toBe(
      'rewrite_from_source',
    );
  });

  it('applies short valid suggestion on full mismatch', () => {
    const item: LlmVerifyItem = {
      id: 11,
      source: 'Controls',
      translation: 'Керування персонажем: [Activate] — взаємодія, [Click] — вибір у меню.',
      grup: 'MESG',
      field: 'ITXT',
      edid: 'HelpControls',
      context: null,
    };
    expect(resolveVerifyFixAction(item, 'incorrect', 'Керування', false, 'fo4').kind).toBe('apply');
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
