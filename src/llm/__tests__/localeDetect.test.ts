import { describe, it, expect } from '@jest/globals';
import {
  buildLocaleDetectUserPayload,
  LOCALE_DETECT_ALLOWED_LANGS,
  parseLlmLocaleDetectResponse,
  LOCALE_DETECT_SYSTEM_PROMPT,
} from '../localeDetect';

describe('buildLocaleDetectUserPayload', () => {
  it('builds JSON audit payload', () => {
    const payload = buildLocaleDetectUserPayload({
      expectedLang: 'en',
      storedLang: 'en',
      isLocalized: false,
      game: 'fo4',
      modName: 'TestMod.esp',
      fileName: 'TestMod.esp',
      samples: [{ id: 7, text: 'Hello', signature: 'WEAP', path: 'WEAP\\FULL', edid: 'MyGun' }],
    });

    expect(payload).toMatchObject({
      task: 'mod_locale_audit',
      expected_language: 'en',
      allowed_languages: LOCALE_DETECT_ALLOWED_LANGS,
      plugin_localized_flag: false,
      samples: [{ id: 7, text: 'Hello' }],
    });
  });
});

describe('parseLlmLocaleDetectResponse', () => {
  const sampleIds = [1, 2];
  const allowed = ['en', 'ru'] as const;

  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      overall_detected_language: 'ru',
      overall_confidence: 0.91,
      verdict: 'mismatch',
      matches_expected: false,
      is_mixed: false,
      summary: 'Samples are Russian.',
      samples: [
        { id: 1, detected_language: 'ru', confidence: 0.9 },
        { id: 2, detected_language: 'ru', confidence: 0.92 },
      ],
    });

    const result = parseLlmLocaleDetectResponse(raw, sampleIds, allowed);
    expect(result.overall_detected_language).toBe('ru');
    expect(result.verdict).toBe('mismatch');
    expect(result.matches_expected).toBe(false);
    expect(result.samples).toHaveLength(2);
  });

  it('strips markdown fences', () => {
    const inner = JSON.stringify({
      overall_detected_language: 'en',
      overall_confidence: 0.99,
      verdict: 'match',
      matches_expected: true,
      is_mixed: false,
      summary: 'English.',
      samples: [
        { id: 1, detected_language: 'en', confidence: 1 },
        { id: 2, detected_language: 'en', confidence: 0.98 },
      ],
    });
    const result = parseLlmLocaleDetectResponse(`\`\`\`json\n${inner}\n\`\`\``, sampleIds, allowed);
    expect(result.verdict).toBe('match');
  });

  it('maps disallowed language codes to unknown', () => {
    const raw = JSON.stringify({
      overall_detected_language: 'russian',
      overall_confidence: 0.9,
      verdict: 'mismatch',
      matches_expected: false,
      is_mixed: false,
      summary: 'Russian.',
      samples: [
        { id: 1, detected_language: 'english', confidence: 0.9 },
        { id: 2, detected_language: 'ru', confidence: 0.92 },
      ],
    });
    const result = parseLlmLocaleDetectResponse(raw, sampleIds, allowed);
    expect(result.overall_detected_language).toBe('unknown');
    expect(result.samples[0]!.detected_language).toBe('unknown');
    expect(result.samples[1]!.detected_language).toBe('ru');
  });

  it('throws when sample id missing', () => {
    expect(() =>
      parseLlmLocaleDetectResponse(
        JSON.stringify({
          overall_detected_language: 'en',
          overall_confidence: 0.5,
          verdict: 'match',
          matches_expected: true,
          is_mixed: false,
          summary: 'x',
          samples: [{ id: 1, detected_language: 'en', confidence: 1 }],
        }),
        sampleIds,
        allowed,
      ),
    ).toThrow(/missing sample id=2/);
  });
});

describe('LOCALE_DETECT_SYSTEM_PROMPT', () => {
  it('requires JSON-only response and allowed_languages constraint', () => {
    expect(LOCALE_DETECT_SYSTEM_PROMPT).toContain('JSON only');
    expect(LOCALE_DETECT_SYSTEM_PROMPT).toContain('allowed_languages');
    expect(LOCALE_DETECT_SYSTEM_PROMPT).toContain('embedded translation');
  });
});
