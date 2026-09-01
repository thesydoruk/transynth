import {
  buildTranslateSystemPrompt,
  buildTranslateUserPayload,
  isUkrainianTargetLang,
  LlmTranslateMissingIdsError,
  parseLlmTranslateResponse,
} from '../translate';
import { buildEnglishTranslateSystemPrompt } from '../prompts/en';
import { buildEnglishPromptExamples } from '../prompts/examples';
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
  it('includes JSON few-shot examples in the Ukrainian FO4 prompt', () => {
    const prompt = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    expect(prompt).toContain('"id": 101');
    expect(prompt).toContain('¤PH0¤ кришок');
    expect(prompt).toContain('### 7. ПРИКЛАДИ ВХОДУ ТА ВИХОДУ');
    expect(prompt).toContain('source_language');
    expect(prompt).toContain('reference_examples');
    expect(prompt).toContain('### 1. ТЕХНІЧНИЙ ФОРМАТ');
  });

  it('includes target-language examples in the English prompt', () => {
    const examples = buildEnglishPromptExamples('de');
    expect(examples).toContain('"target_language": "de"');
    expect(examples).toContain('Kronkorken');
    const prompt = buildEnglishTranslateSystemPrompt('en', 'de', 'fo4');
    expect(prompt).toContain('Example input');
    expect(prompt).toContain('reference_examples');
    expect(prompt).toContain('TECHNICAL REQUIREMENTS');
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
            },
          ],
        },
      ],
    });
  });

  it('omits empty metadata and RAG ranking fields', () => {
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
              grup: null,
              edid: null,
              field: null,
              match_method: 'exact',
              similarity: 1,
            },
          ],
        },
      ],
      srcLang: 'en',
      targetLang: 'uk',
    });

    expect(payload).toEqual({
      source_language: 'en',
      target_language: 'uk',
      game: null,
      items: [
        {
          id: 1,
          source: 'Test',
          reference_examples: [{ source: 'Src', translation: 'Trg' }],
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

  it('throws LlmTranslateMissingIdsError when some ids are missing', () => {
    const raw = JSON.stringify({ items: [{ id: 1, translation: 'OK' }] });
    expect(() => parseLlmTranslateResponse(raw, [1, 2])).toThrow(LlmTranslateMissingIdsError);
    try {
      parseLlmTranslateResponse(raw, [1, 2]);
    } catch (err) {
      expect(err).toMatchObject({
        missingIds: [2],
        partialResults: [{ id: 1, translation: 'OK' }],
      });
    }
  });

  it('throws LlmTranslateMissingIdsError when every expected id is missing', () => {
    const raw = JSON.stringify({ items: [] });
    expect(() => parseLlmTranslateResponse(raw, [1, 2])).toThrow(LlmTranslateMissingIdsError);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLlmTranslateResponse('{{{', [1])).toThrow(/not valid JSON/);
  });

  it('accepts items with echoed input metadata when JSON is valid', () => {
    const raw = JSON.stringify({
      items: [
        {
          id: 9,
          translation: 'Текст',
          grup: 'TERM',
          edid: 'X',
          field: 'BTXT',
          form_id: '1',
          context: null,
        },
      ],
    });
    expect(parseLlmTranslateResponse(raw, [9])).toEqual([{ id: 9, translation: 'Текст' }]);
  });
});

describe('parseLlmTranslateResponse salvage', () => {
  it('salvages truncated translate JSON without logging-only failure', () => {
    const inner = '{"items":[{"id":99,"translation":"Частина тексту';
    const raw = JSON.stringify(inner);
    expect(parseLlmTranslateResponse(raw, [99])).toEqual([
      { id: 99, translation: 'Частина тексту' },
    ]);
  });

  it('parses vLLM double-encoded JSON with a missing outer closing quote', () => {
    const inner = JSON.stringify({ items: [{ id: 2177256, translation: 'Повний текст' }] });
    const raw = JSON.stringify(inner).slice(0, -1);
    expect(parseLlmTranslateResponse(raw, [2177256])).toEqual([
      { id: 2177256, translation: 'Повний текст' },
    ]);
  });
});
