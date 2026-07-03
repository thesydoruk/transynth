import { describe, it, expect } from '@jest/globals';
import {
  isCorruptedVerifyTranslation,
  isFullTranslationMismatch,
  isRewriteUnchangedConfirmation,
  looksLikeTruncatedSuggestion,
  looksLikeVerifyJsonArtifact,
  normalizeVerifySuggestionText,
  parseVerifySuggestionValue,
  reconcileVerifyResult,
  resolveVerifyFixAction,
  shouldRewriteFromSource,
  validateRewrittenTranslation,
  validateVerifySuggestion,
} from '../verifySuggestionGuards';
import type { LlmVerifyItem } from '../verifyTranslate';

describe('normalizeVerifySuggestionText', () => {
  it('unwraps verify JSON artifacts into inner suggestion text', () => {
    const artifact = JSON.stringify({
      id: 779051,
      verdict: 'suspicious',
      reason: 'Bad terms.',
      confidence: 0.9,
      suggestion: 'Повний переклад без JSON.',
    });
    expect(normalizeVerifySuggestionText(artifact)).toBe('Повний переклад без JSON.');
  });

  it('returns null for verify JSON artifacts without inner suggestion', () => {
    const artifact = JSON.stringify({
      id: 779051,
      verdict: 'suspicious',
      reason: 'Bad terms.',
      confidence: 0.9,
      suggestion: null,
    });
    expect(normalizeVerifySuggestionText(artifact)).toBeNull();
  });
});

describe('parseVerifySuggestionValue', () => {
  it('returns null for ok verdict even when suggestion is present', () => {
    expect(parseVerifySuggestionValue('Ignored.', 'ok')).toBeNull();
  });
});

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

  it('rejects verify JSON artifacts', () => {
    const item: LlmVerifyItem = {
      id: 3,
      source: 'Insomnia',
      translation: 'Безсоння',
      grup: 'PERK',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const artifact = JSON.stringify({
      id: 779051,
      verdict: 'suspicious',
      reason: 'Bad terms.',
      confidence: 0.9,
      suggestion: 'Інсомнія: ви спите менше.',
    });
    const result = validateVerifySuggestion(item, artifact, 'fo4');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('json_artifact');
  });

  it('does not treat inline ellipsis in prose as truncated', () => {
    expect(looksLikeTruncatedSuggestion('Wait... what?')).toBe(false);
    expect(looksLikeTruncatedSuggestion('Line one\n...\nLine three')).toBe(true);
  });

  it('rejects truncated suggestions with ellipsis', () => {
    const item: LlmVerifyItem = {
      id: 4,
      source: 'Line one\nLine two',
      translation: 'Рядок один\nРядок два',
      grup: 'PERK',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const result = validateVerifySuggestion(
      item,
      'Інсомнія: ви спите менше.\nЛергія: AP повільніше.\n...\nКофеїн дає перерву.',
      'fo4',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('truncated');
  });
});

describe('resolveVerifyFixAction', () => {
  it('rewrites incorrect rows instead of applying partial fixes', () => {
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
    expect(action.kind).toBe('rewrite_from_source');
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

  it('rewrites incorrect rows even when suggestion preserves tokens', () => {
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
    expect(action.kind).toBe('rewrite_from_source');
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

  it('rewrites suspicious fixes when suggestion is a verify JSON artifact', () => {
    const item: LlmVerifyItem = {
      id: 12,
      source: 'Insomnia: you sleep less.\nLethargy: AP regen slower.',
      translation: 'Безсоння: ви спите менше.\nЛергія: AP повільніше.',
      grup: 'PERK',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const artifact = JSON.stringify({
      id: 779051,
      verdict: 'suspicious',
      reason: 'Bad terms.',
      confidence: 0.9,
      suggestion: 'Інсомнія: ви спите менше.\n...\nКофеїн дає перерву.',
    });
    expect(looksLikeVerifyJsonArtifact(artifact)).toBe(true);
    expect(
      resolveVerifyFixAction(
        item,
        'suspicious',
        normalizeVerifySuggestionText(artifact),
        true,
        'fo4',
      ).kind,
    ).toBe('rewrite_from_source');
  });

  it('rewrites suspicious fixes when suggestion is truncated', () => {
    const item: LlmVerifyItem = {
      id: 13,
      source: 'Insomnia: you sleep less.\nLethargy: AP regen slower.',
      translation: 'Безсоння: ви спите менше.\nЛергія: AP повільніше.',
      grup: 'PERK',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const action = resolveVerifyFixAction(
      item,
      'suspicious',
      'Інсомнія: ви спите менше.\n...\nКофеїн дає перерву.',
      true,
      'fo4',
    );
    expect(action.kind).toBe('rewrite_from_source');
  });

  it('rewrites suspicious multi-line rows without suggestion when fixSuspicious is enabled', () => {
    const item: LlmVerifyItem = {
      id: 14,
      source: 'Insomnia: you sleep less.\nLethargy: AP regen slower.',
      translation: 'Безсоння: ви спите менше.\nЛергія: AP повільніше.',
      grup: 'PERK',
      field: 'DESC',
      edid: null,
      context: null,
    };
    expect(resolveVerifyFixAction(item, 'suspicious', null, true, 'fo4').kind).toBe(
      'rewrite_from_source',
    );
    expect(resolveVerifyFixAction(item, 'suspicious', null, false, 'fo4').kind).toBe('flag_only');
  });

  it('approves suspicious rows when suggestion matches current translation', () => {
    const item: LlmVerifyItem = {
      id: 15,
      source: 'Ballistic Weave Mk4',
      translation: 'Куленепробивний шар, клас 4',
      grup: 'ARMO',
      field: 'FULL',
      edid: 'mod_armor_Railroad_ClothingArmor4',
      context: null,
    };
    expect(
      resolveVerifyFixAction(item, 'suspicious', 'Куленепробивний шар, клас 4', true, 'fo4').kind,
    ).toBe('approve_as_ok');
  });

  it('rewrites corrupted verify JSON stored as translation even without fixSuspicious', () => {
    const artifact = JSON.stringify({
      id: 779051,
      verdict: 'suspicious',
      reason: 'Bad terms.',
      confidence: 0.9,
      suggestion: 'Partial fix',
    }).slice(0, 120);
    const item: LlmVerifyItem = {
      id: 779051,
      source: 'Insomnia: you sleep less.\nLethargy: AP regen slower.',
      translation: artifact,
      grup: 'MESG',
      field: 'DESC',
      edid: 'HC_HelpSurvival',
      context: null,
    };
    expect(isCorruptedVerifyTranslation(item.translation)).toBe(true);
    expect(resolveVerifyFixAction(item, 'ok', null, false, 'fo4').kind).toBe('rewrite_from_source');
  });
});

describe('validateRewrittenTranslation', () => {
  it('accepts rewritten text replacing corrupted JSON translation', () => {
    const artifact = '{"id":779051,"verdict":"suspicious","reason":"Bad"}';
    const item: LlmVerifyItem = {
      id: 779051,
      source: 'Insomnia: you sleep less.',
      translation: artifact,
      grup: 'MESG',
      field: 'DESC',
      edid: null,
      context: null,
    };
    const result = validateRewrittenTranslation(item, 'Безсоння: ви спите менше.', 'fo4');
    expect(result.ok).toBe(true);
  });

  it('flags unchanged rewrite as confirmation candidate', () => {
    const item: LlmVerifyItem = {
      id: 55079,
      source: 'Scrap ?',
      translation: 'Розібрати ?',
      grup: 'GMST',
      field: 'DATA',
      edid: null,
      context: null,
    };
    const result = validateRewrittenTranslation(item, 'Розібрати ?', 'fo4');
    expect(result.ok).toBe(false);
    expect(isRewriteUnchangedConfirmation(result)).toBe(true);
  });

  it('does not treat empty rewrite as confirmation', () => {
    const item: LlmVerifyItem = {
      id: 1,
      source: 'Test',
      translation: 'Тест',
      grup: 'GMST',
      field: 'DATA',
      edid: null,
      context: null,
    };
    const result = validateRewrittenTranslation(item, '   ', 'fo4');
    expect(result.ok).toBe(false);
    expect(isRewriteUnchangedConfirmation(result)).toBe(false);
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
