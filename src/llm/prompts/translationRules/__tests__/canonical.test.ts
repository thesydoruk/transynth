import type { GameType } from '../../../../types';
import { GAME_UK_GLOSSARIES } from '../../../../resources/glossary';
import { FO4_UK_GLOSSARY } from '../../../../resources/glossary/fo4-uk';
import {
  canonicalEnHeader,
  canonicalUkHeader,
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../canonical';
import { GAME_RULES } from '../games';
import { buildEnglishTranslationRules, buildUkrainianTranslationRules } from '../index';
import { buildEnglishTranslateSystemPrompt, buildEnglishVerifySystemPrompt } from '../../en';
import { buildUkrainianTranslateSystemPrompt, buildUkrainianVerifySystemPrompt } from '../../uk';

const ALL_GAMES: GameType[] = ['fo4', 'fo76', 'fo3', 'fnv', 'ob', 'mw', 'sse', 'sle'];

describe('canonical terminology', () => {
  it('every game has a non-empty UK glossary', () => {
    for (const game of ALL_GAMES) {
      expect(GAME_UK_GLOSSARIES[game].length).toBeGreaterThan(0);
    }
  });

  it('formats Ukrainian canonical lines for every glossary entry', () => {
    const lines = formatCanonicalUkLines('TEST GAME', [
      { term: 'Stealth Boy', translation: 'Стелс-бой' },
      { term: 'Brotherhood of Steel', translation: 'Братерство сталі' },
    ]);
    expect(lines[0]).toBe(canonicalUkHeader('TEST GAME'));
    expect(lines).toContain('- Stealth Boy → Стелс-бой');
    expect(lines).toContain('- Brotherhood of Steel → Братерство сталі');
  });

  it('formats English canonical term list', () => {
    const lines = formatCanonicalEnLines(
      'FALLOUT 4',
      [{ term: 'Stealth Boy', translation: 'Стелс-бой' }],
      'de',
    );
    expect(lines[0]).toBe(canonicalEnHeader('FALLOUT 4'));
    expect(lines.some((l) => l.includes('Stealth Boy'))).toBe(true);
    expect(lines.some((l) => l.includes('de'))).toBe(true);
  });

  it.each(ALL_GAMES)('Ukrainian rules for %s include full canonical section', (game) => {
    const rules = buildUkrainianTranslationRules(game);
    expect(rules).toMatch(/### КАНОНІЧНА ТЕРМІНОЛОГІЯ .+ \(за відсутності "glossary" у запиті\):/);

    for (const { term, translation } of GAME_UK_GLOSSARIES[game]) {
      expect(rules).toContain(`${term} → ${translation}`);
    }
  });

  it.each(ALL_GAMES)('English rules for %s list every canonical English term', (game) => {
    const rules = buildEnglishTranslationRules('de', game);
    expect(rules).toMatch(/### .+ CANONICAL TERMINOLOGY/);

    const terms = [...new Set(GAME_UK_GLOSSARIES[game].map((e) => e.term))];
    for (const term of terms) {
      expect(rules).toContain(`- ${term}`);
    }
  });

  it('FO4 Ukrainian prompt includes Stealth Boy canonical pair', () => {
    const rules = buildUkrainianTranslationRules('fo4');
    expect(rules).toContain('Stealth Boy → Стелс-бой');
  });

  it('every FO4 glossary entry appears in Ukrainian translate and verify prompts', () => {
    const rules = buildUkrainianTranslationRules('fo4');
    const translate = buildUkrainianTranslateSystemPrompt('en', 'fo4');
    const verify = buildUkrainianVerifySystemPrompt('en', 'fo4');

    for (const { term, translation } of FO4_UK_GLOSSARY) {
      const pair = `${term} → ${translation}`;
      expect(rules).toContain(pair);
      expect(translate).toContain(pair);
      expect(verify).toContain(pair);
    }
  });

  it('every game injects canonical rules into English translate and verify prompts', () => {
    for (const game of ALL_GAMES) {
      const rules = buildEnglishTranslationRules('pl', game);
      const translate = buildEnglishTranslateSystemPrompt('en', 'pl', game);
      const verify = buildEnglishVerifySystemPrompt('en', 'pl', game);
      expect(translate).toContain(rules);
      expect(verify).toContain(rules);
    }
  });

  it('sle shares sse glossary and rules', () => {
    expect(GAME_UK_GLOSSARIES.sle).toBe(GAME_UK_GLOSSARIES.sse);
    expect(buildUkrainianTranslationRules('sle')).toBe(buildUkrainianTranslationRules('sse'));
    expect(GAME_RULES.sle).toBe(GAME_RULES.sse);
  });
});
