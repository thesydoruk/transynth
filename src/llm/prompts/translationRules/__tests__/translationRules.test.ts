import { buildEnglishTranslateSystemPrompt, buildEnglishVerifySystemPrompt } from '../../en';
import { buildUkrainianTranslateSystemPrompt, buildUkrainianVerifySystemPrompt } from '../../uk';
import {
  buildEnglishTranslationRules,
  buildUkrainianTranslationRules,
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

  it('uses different rules per game', () => {
    const fo4 = buildUkrainianTranslationRules('fo4');
    const sse = buildUkrainianTranslationRules('sse');
    expect(fo4).toContain('Fallout 4');
    expect(fo4).toContain('### КАНОНІЧНА ТЕРМІНОЛОГІЯ FALLOUT 4');
    expect(fo4).toContain('Stealth Boy → Стелс-бой');
    expect(fo4).toContain('Інститут');
    expect(sse).toContain('Skyrim');
    expect(sse).toContain('ПРИКЛАДИ (Skyrim)');
    expect(sse).toContain('ярл');
    expect(sse).not.toContain('Інститут');
  });

  it('defaults unknown game to fo4', () => {
    expect(resolveGameType(null)).toBe('fo4');
    expect(resolveGameType('unknown-mod')).toBe('fo4');
    expect(buildUkrainianTranslationRules(undefined)).toContain('Fallout 4');
  });

  it('sle shares rules with sse', () => {
    expect(buildUkrainianTranslationRules('sle')).toBe(buildUkrainianTranslationRules('sse'));
  });

  it('includes New Vegas factions for fnv', () => {
    const fnv = buildUkrainianTranslationRules('fnv');
    expect(fnv).toContain('Легіон Цезаря');
    expect(fnv).toContain('НКР');
  });

  it('includes Morrowind-specific tone for mw', () => {
    const mw = buildUkrainianTranslationRules('mw');
    expect(mw).toContain('Morrowind');
    expect(mw).toContain('данмер');
  });

  it('is injected into translate and verify prompts with game', () => {
    const rules = buildEnglishTranslationRules('de', 'fo4');
    const translatePrompt = buildEnglishTranslateSystemPrompt('en', 'de', 'fo4');
    const verifyPrompt = buildEnglishVerifySystemPrompt('en', 'de', 'fo4');
    expect(translatePrompt).toContain(rules);
    expect(verifyPrompt).toContain(rules);
    expect(verifyPrompt).toContain('Power Armor part names');
  });

  it('injects game-specific verify notes for Ukrainian Fallout 4', () => {
    const verifyPrompt = buildUkrainianVerifySystemPrompt('en', 'fo4');
    expect(verifyPrompt).toContain('силової броні');
    const skyrimVerify = buildUkrainianVerifySystemPrompt('en', 'sse');
    expect(skyrimVerify).toContain('Лексика Fallout');
    expect(skyrimVerify).not.toContain('силової броні');
  });

  it('is injected into Ukrainian translate prompts per game', () => {
    const ukRules = buildUkrainianTranslationRules('fo4');
    const translatePrompt = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    expect(translatePrompt).toContain(ukRules);
  });
});
