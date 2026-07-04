import { buildEnglishTranslateSystemPrompt, buildEnglishVerifySystemPrompt } from '../../en';
import { buildUkrainianTranslateSystemPrompt, buildUkrainianVerifySystemPrompt } from '../../uk';
import {
  buildEnglishTranslationRules,
  buildEnglishVerifyTranslationRules,
  resolveGameType,
} from '../index';

describe('translationRules', () => {
  it('includes common and game-specific sections for English', () => {
    const fo4Rules = buildEnglishTranslationRules('de', 'fo4');
    expect(fo4Rules).toContain('### PLACEHOLDER AND TAG PRESERVATION');
    expect(fo4Rules).toContain('### CAPITALIZATION:');
    expect(fo4Rules).toContain('### STYLE, TONE, AND ATMOSPHERE (Fallout 4):');
    expect(fo4Rules).toContain('### FALLOUT 4 CANONICAL TERMINOLOGY');
    expect(fo4Rules).toContain('Stealth Boy');
    expect(fo4Rules).toContain('Institute');
  });

  it('interpolates target language in linguistic quality', () => {
    expect(buildEnglishTranslationRules('pl', 'fo4')).toContain('idiomatic pl');
  });

  it('defaults unknown game to fo4', () => {
    expect(resolveGameType(null)).toBe('fo4');
    expect(resolveGameType('unknown-mod')).toBe('fo4');
    expect(buildUkrainianTranslateSystemPrompt('en', null)).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'fo4'),
    );
  });

  it('sle shares prompts with sse', () => {
    expect(buildUkrainianTranslateSystemPrompt('en', 'sle')).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'sse'),
    );
    expect(buildUkrainianVerifySystemPrompt('en', 'sle')).toBe(
      buildUkrainianVerifySystemPrompt('en', 'sse'),
    );
  });

  it('is injected into translate and verify prompts with game', () => {
    const rules = buildEnglishTranslationRules('de', 'fo4');
    const verifyRules = buildEnglishVerifyTranslationRules('de', 'fo4');
    const translatePrompt = buildEnglishTranslateSystemPrompt('en', 'de', 'fo4');
    const verifyPrompt = buildEnglishVerifySystemPrompt('en', 'de', 'fo4');
    expect(translatePrompt).toContain(rules);
    expect(verifyPrompt).toContain(verifyRules);
    expect(verifyPrompt).toContain('VERIFY — item/mod names');
  });

  it('uses per-game Ukrainian standalone prompts', () => {
    const fo4 = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    const fnv = buildUkrainianTranslateSystemPrompt('en', 'fnv');
    const sse = buildUkrainianTranslateSystemPrompt('en', 'sse');
    expect(fo4).toContain('### 1. ТЕХНІЧНИЙ ФОРМАТ');
    expect(fo4).toContain('Fallout 4');
    expect(fnv).toContain('FALLOUT: NEW VEGAS');
    expect(sse).toContain('SKYRIM');
    expect(fnv).not.toContain('### ТЕХНІЧНІ ВИМОГИ');
  });

  it('injects game-specific verify rules for Ukrainian Fallout 4', () => {
    const verifyPrompt = buildUkrainianVerifySystemPrompt('en', 'fo4');
    expect(verifyPrompt).toContain('### 6. СПЕЦИФІЧНІ ПРАВИЛА');
    expect(verifyPrompt).toContain('Hellfire Mk.II Arm Armor');
    expect(verifyPrompt).toContain('reference_examples');
    const skyrimVerify = buildUkrainianVerifySystemPrompt('en', 'sse');
    expect(skyrimVerify).toContain('Лексика Fallout');
    expect(skyrimVerify).not.toContain('силової броні');
  });
});
