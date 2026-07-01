import { describe, it, expect } from '@jest/globals';
import {
  buildVerifySystemPrompt,
  buildVerifyTranslateUserPayload,
  parseLlmVerifyTranslateResponse,
  applyPlaceholderGuardToVerifyResult,
  VERIFY_TRANSLATE_SYSTEM_PROMPT,
} from '../verifyTranslate';
import { buildEnglishVerifySystemPrompt } from '../prompts/en';
import { buildUkrainianVerifySystemPrompt } from '../prompts/uk';

describe('buildVerifyTranslateUserPayload', () => {
  it('builds JSON audit payload', () => {
    const payload = buildVerifyTranslateUserPayload({
      srcLang: 'en',
      targetLang: 'uk',
      game: 'fo4',
      modName: 'TestMod.esp',
      items: [
        {
          id: 7,
          source: 'Hello',
          translation: 'Привіт',
          grup: 'WEAP',
          field: 'FULL',
          edid: 'MyGun',
          context: null,
          reference_examples: [
            {
              source: 'Goodbye',
              translation: 'Бувай',
              grup: 'INFO',
              edid: 'Line01',
              field: 'NAM1',
              match_method: 'exact',
              similarity: 1,
            },
          ],
        },
      ],
    });

    expect(payload).toMatchObject({
      task: 'translation_quality_audit',
      source_language: 'en',
      target_language: 'uk',
      items: [
        {
          id: 7,
          source: 'Hello',
          translation: 'Привіт',
          grup: 'WEAP',
          field: 'FULL',
          reference_examples: [{ source: 'Goodbye', translation: 'Бувай' }],
        },
      ],
    });
  });
});

describe('parseLlmVerifyTranslateResponse', () => {
  const itemIds = [1, 2];

  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      items: [
        { id: 1, verdict: 'ok', reason: 'Good.', confidence: 0.95, suggestion: null },
        {
          id: 2,
          verdict: 'incorrect',
          reason: 'Wrong meaning.',
          confidence: 0.88,
          suggestion: 'Fixed text.',
        },
      ],
    });

    const result = parseLlmVerifyTranslateResponse(raw, itemIds);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 1, verdict: 'ok', suggestion: null });
    expect(result[1]).toMatchObject({
      id: 2,
      verdict: 'incorrect',
      reason: 'Wrong meaning.',
      suggestion: 'Fixed text.',
    });
  });

  it('ignores suggestion for ok verdict', () => {
    const raw = JSON.stringify({
      items: [{ id: 1, verdict: 'ok', reason: 'Good.', confidence: 0.95, suggestion: 'Ignored.' }],
    });
    expect(parseLlmVerifyTranslateResponse(raw, [1])[0]?.suggestion).toBeNull();
  });

  it('throws when an item id is missing', () => {
    const raw = JSON.stringify({
      items: [{ id: 1, verdict: 'ok', reason: 'Good.', confidence: 0.9 }],
    });
    expect(() => parseLlmVerifyTranslateResponse(raw, itemIds)).toThrow(/missing item id=2/);
  });

  it('accepts string item ids from the LLM', () => {
    const raw = JSON.stringify({
      items: [
        { id: '1', verdict: 'ok', reason: 'Good.', confidence: 0.9, suggestion: null },
        {
          id: '2',
          verdict: 'incorrect',
          reason: 'Wrong meaning.',
          confidence: 0.88,
          suggestion: 'Fixed text.',
        },
      ],
    });

    const result = parseLlmVerifyTranslateResponse(raw, itemIds);
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(1);
    expect(result[1]?.id).toBe(2);
  });

  it('exports a non-empty default system prompt', () => {
    expect(VERIFY_TRANSLATE_SYSTEM_PROMPT).toContain('suspicious');
  });
});

describe('buildVerifySystemPrompt', () => {
  it('uses Ukrainian prompt for uk target', () => {
    const prompt = buildVerifySystemPrompt('en', 'uk', 'fo4');
    expect(prompt).toContain('українською');
    expect(prompt).not.toBe(VERIFY_TRANSLATE_SYSTEM_PROMPT);
  });

  it('uses default English prompt for non-Ukrainian targets', () => {
    expect(buildVerifySystemPrompt('en', 'de', 'fo4')).toBe(
      buildEnglishVerifySystemPrompt('en', 'de', 'fo4'),
    );
  });

  it('English verify prompt mentions reference examples', () => {
    expect(buildEnglishVerifySystemPrompt('en', 'de', 'fo4')).toContain('reference_examples');
  });

  it('Ukrainian verify prompt mentions reference examples', () => {
    expect(buildUkrainianVerifySystemPrompt('en', 'fo4')).toContain('reference_examples');
  });
});

describe('applyPlaceholderGuardToVerifyResult', () => {
  const item = {
    id: 1,
    source: 'You have %d caps',
    translation: 'У тебе %s кришок',
    grup: 'INFO',
    field: 'NAM1',
    edid: null,
    context: null,
  };

  it('upgrades ok verdict to incorrect on token mismatch', () => {
    const guarded = applyPlaceholderGuardToVerifyResult(
      item,
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.9, suggestion: null },
      'fo4',
    );
    expect(guarded.verdict).toBe('incorrect');
    expect(guarded.reason).toContain('Protected token mismatch');
  });

  it('leaves ok verdict when tokens match', () => {
    const guarded = applyPlaceholderGuardToVerifyResult(
      { ...item, translation: 'У тебе %d кришок' },
      { id: 1, verdict: 'ok', reason: 'Fine.', confidence: 0.9, suggestion: null },
      'fo4',
    );
    expect(guarded.verdict).toBe('ok');
  });
});
