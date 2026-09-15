import type { GameId } from '../../../../types';
import { allGameIds, gamePlugin } from '../../../../games/registry';
import { DISCO_UK_GLOSSARY } from '../../../../games/disco-elysium/prompts/glossary';
import {
  canonicalEnHeader,
  canonicalUkHeader,
  formatCanonicalEnLines,
  formatCanonicalUkLines,
} from '../canonical';
import { buildEnglishTranslationRules, buildEnglishVerifyTranslationRules } from '..';
import { buildEnglishTranslateSystemPrompt, buildEnglishVerifySystemPrompt } from '../../en';
import { buildUkrainianTranslateSystemPrompt, buildUkrainianVerifySystemPrompt } from '../../uk';

const ALL_GAMES: GameId[] = [...allGameIds()];

const glossaryOf = (game: GameId) => gamePlugin(game).prompts.glossary;
const rulesOf = (game: GameId) => gamePlugin(game).prompts.rules;

describe('canonical terminology', () => {
  it('every game has a non-empty UK glossary', () => {
    for (const game of ALL_GAMES) {
      expect(glossaryOf(game).length).toBeGreaterThan(0);
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

  it.each(ALL_GAMES)('English rules for %s list every canonical English term', (game) => {
    const rules = buildEnglishTranslationRules('de', game);
    expect(rules).toMatch(/### .+ CANONICAL TERMINOLOGY/);

    const terms = [...new Set(glossaryOf(game).map((entry) => entry.term))];
    for (const term of terms) {
      expect(rules).toContain(`- ${term}`);
    }
  });

  it('FO4 Ukrainian prompts do not dump the full glossary JSON', () => {
    const translate = buildUkrainianTranslateSystemPrompt('en', 'fo4', 'dialog');
    const verify = buildUkrainianVerifySystemPrompt('en', 'fo4', 'dialog');
    expect(translate).toContain('Поле "glossary"');
    expect(verify).toContain('Поле "glossary"');
    expect(translate).toContain('техно-лицарі');
    expect(verify).toContain('техно-лицарі');
    expect(translate).toContain('непередбачені наслідки');
    expect(verify).toContain('непередбачені наслідки');
    expect(translate).toContain('посадова інструкція');
    expect(verify).toContain('посадова інструкція');
    expect(translate).toContain('характерну хуйню');
    expect(verify).toContain('характерну хуйню');
    expect(translate).toContain('гаражні технарі');
    expect(verify).toContain('гаражні технарі');
    expect(translate).toContain('народна самооборона');
    expect(verify).toContain('народна самооборона');
    expect(translate).toContain('постапокаліптичного писання');
    expect(verify).toContain('постапокаліптичного писання');
    expect(translate).not.toContain('"term": "Addictol"');
    expect(verify).not.toContain('"term": "Addictol"');

    // Backstop for a dump that slips past the checks above. The FO4 glossary is
    // ~10 KB of JSON, so a budget a few KB over the current prompt still catches
    // one while leaving the rule blocks room to grow. Trim the prompt before
    // raising this: every character is paid on every request.
    expect(translate.length).toBeLessThan(34_000);
    expect(translate.length + JSON.stringify(glossaryOf('fo4')).length).toBeGreaterThan(34_000);
  });

  it('every Disco glossary entry appears in Ukrainian translate and verify prompts as JSON', () => {
    const translate = buildUkrainianTranslateSystemPrompt('en', 'disco');
    const verify = buildUkrainianVerifySystemPrompt('en', 'disco');

    for (const { term, translation } of DISCO_UK_GLOSSARY) {
      expect(translate).toContain(`"term": "${term}"`);
      expect(translate).toContain(`"translation": "${translation}"`);
      expect(verify).toContain(`"term": "${term}"`);
      expect(verify).toContain(`"translation": "${translation}"`);
    }
  });

  it('every game injects canonical rules into English translate and verify prompts', () => {
    for (const game of ALL_GAMES) {
      const rules = buildEnglishTranslationRules('pl', game);
      const verifyRules = buildEnglishVerifyTranslationRules('pl', game);
      const translate = buildEnglishTranslateSystemPrompt('en', 'pl', game);
      const verify = buildEnglishVerifySystemPrompt('en', 'pl', game);
      expect(translate).toContain(rules);
      expect(verify).toContain(verifyRules);
      if (game !== 'disco') {
        expect(verify).toContain('TEMPLATE CONSISTENCY (VERIFY)');
      } else {
        expect(verify).not.toContain('ESP/ESM');
        expect(verify).toContain('Disco Elysium');
      }
    }
  });

  it('sle shares sse glossary and rules', () => {
    expect(glossaryOf('sle')).toBe(glossaryOf('sse'));
    expect(buildUkrainianTranslateSystemPrompt('en', 'sle')).toBe(
      buildUkrainianTranslateSystemPrompt('en', 'sse'),
    );
    expect(rulesOf('sle')).toBe(rulesOf('sse'));
  });
});
