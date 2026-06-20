import {
  buildTranslateSystemPrompt,
  buildTranslateUserPayload,
  isUkrainianTargetLang,
  parseLlmTranslateResponse,
} from '../translate';
import { buildEnglishTranslateSystemPrompt } from '../prompts/en';
import { buildEnglishPromptExamples, buildUkrainianPromptExamples } from '../prompts/examples';
import { buildUkrainianTranslateSystemPrompt } from '../prompts/uk';

describe('isUkrainianTargetLang', () => {
  it.each(['uk', 'UA', 'ukr', 'ukrainian'])('returns true for %s', (lang) => {
    expect(isUkrainianTargetLang(lang)).toBe(true);
  });

  it('returns false for other languages', () => {
    expect(isUkrainianTargetLang('en')).toBe(false);
    expect(isUkrainianTargetLang('de')).toBe(false);
  });
});

describe('buildTranslateSystemPrompt', () => {
  it('uses the Ukrainian prompt for uk target language', () => {
    expect(buildTranslateSystemPrompt('en', 'uk', 'fo4')).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'fo4'),
    );
  });

  it('uses the English prompt for non-Ukrainian targets', () => {
    expect(buildTranslateSystemPrompt('en', 'de', 'fo4')).toBe(
      buildEnglishTranslateSystemPrompt('en', 'de', 'fo4'),
    );
  });
});

describe('prompt examples', () => {
  it('includes JSON few-shot examples in the Ukrainian prompt', () => {
    const examples = buildUkrainianPromptExamples();
    expect(examples).toContain('"id": 101');
    expect(examples).toContain('¤PH0¤ кришок');
    expect(buildUkrainianTranslateSystemPrompt('en', 'fo4')).toContain('Приклад вхідних даних');
  });

  it('includes target-language examples in the English prompt', () => {
    const examples = buildEnglishPromptExamples('de');
    expect(examples).toContain('"target_language": "de"');
    expect(examples).toContain('Kronkorken');
    expect(buildEnglishTranslateSystemPrompt('en', 'de', 'fo4')).toContain('Example input');
  });
});

describe('buildTranslateUserPayload', () => {
  it('builds structured JSON with metadata and glossary', () => {
    const payload = buildTranslateUserPayload({
      items: [
        {
          id: 42,
          source: 'Hello ¤PH0¤',
          grup: 'INFO',
          field: 'NAM1',
          form_id: '00123456',
          edid: 'MyLine',
          context: 'Codsworth',
        },
      ],
      srcLang: 'en',
      targetLang: 'uk',
      game: 'fo4',
      modName: 'TestMod',
      glossary: [{ term: 'Vault', translation: 'Сховище' }],
      styleGuide: 'Use informal tone.',
    });

    expect(payload).toEqual({
      source_language: 'en',
      target_language: 'uk',
      game: 'fo4',
      mod_name: 'TestMod',
      style_guide: 'Use informal tone.',
      glossary: [{ term: 'Vault', translation: 'Сховище' }],
      items: [
        {
          id: 42,
          source: 'Hello ¤PH0¤',
          grup: 'INFO',
          field: 'NAM1',
          form_id: '00123456',
          edid: 'MyLine',
          context: 'Codsworth',
        },
      ],
    });
  });

  it('includes reference_examples when provided on items', () => {
    const payload = buildTranslateUserPayload({
      items: [
        {
          id: 1,
          source: 'Test',
          grup: null,
          field: null,
          form_id: null,
          edid: null,
          context: null,
          reference_examples: [
            {
              source: 'Src',
              translation: 'Trg',
              grup: 'INFO',
              edid: 'Line01',
              field: 'NAM1',
              match_method: 'exact',
              similarity: 1,
            },
          ],
        },
      ],
      srcLang: 'en',
      targetLang: 'uk',
    });

    expect(payload).toMatchObject({
      items: [
        {
          id: 1,
          reference_examples: [
            {
              source: 'Src',
              translation: 'Trg',
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
  });
});

describe('parseLlmTranslateResponse', () => {
  it('parses a valid JSON object', () => {
    const raw = JSON.stringify({
      items: [
        { id: 1, translation: 'Перший' },
        { id: 2, translation: 'Другий' },
      ],
    });

    expect(parseLlmTranslateResponse(raw, [1, 2])).toEqual([
      { id: 1, translation: 'Перший' },
      { id: 2, translation: 'Другий' },
    ]);
  });

  it('accepts markdown fenced JSON', () => {
    const raw = '```json\n{"items":[{"id":7,"translation":"Тест"}]}\n```';
    expect(parseLlmTranslateResponse(raw, [7])).toEqual([{ id: 7, translation: 'Тест' }]);
  });

  it('throws when an expected id is missing', () => {
    const raw = JSON.stringify({ items: [{ id: 1, translation: 'OK' }] });
    expect(() => parseLlmTranslateResponse(raw, [1, 2])).toThrow('missing translation for id=2');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLlmTranslateResponse('not json', [1])).toThrow('not valid JSON');
  });
});
