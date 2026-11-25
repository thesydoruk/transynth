import { describe, expect, it } from '@jest/globals';
import type { SpeakerGender } from '../../../dialog/gender';
import { findUkrainianGenderConflicts } from '../../../dialog/ukrainianGender';
import type { LlmPromptFamily } from '../../../llm/promptFamily';
import {
  buildUkrainianTranslateSystemPrompt,
  buildUkrainianVerifySystemPrompt,
} from '../../../llm/prompts/uk';
import { buildEnglishTranslationRules } from '../../../llm/prompts/translationRules';
import { glossaryTermMatchesSource } from '../../../web/data/queries/glossaryHelpers';
import { SF1_UK_GLOSSARY } from '../data/glossary/sf1-uk';
import { fo4UkTranslatePrompt, fo4UkVerifyPrompt } from '../prompts/fo4/families';
import { sf1Rules } from '../prompts/rules/sf1';
import {
  SF1_PROMPT_FAMILIES,
  sf1UkTranslatePrompt,
  sf1UkVerifyPrompt,
} from '../prompts/sf1/families';
import { SF1_UK_DIALOG_EXAMPLES } from '../prompts/sf1/families/dialog';
import { SF1_UK_INTERACTION_VERBS } from '../prompts/sf1/families/item';

/** Words of another game's canon that must never reach a Starfield prompt. */
const FALLOUT_VOCABULARY = ['Піп-бой', 'Сховище', 'кришк', 'Нейт', 'Нора', 'пустк', 'Пустк'];

const everyPrompt = (): Array<[string, string]> =>
  SF1_PROMPT_FAMILIES.flatMap(
    (family): Array<[string, string]> => [
      [`translate ${family}`, sf1UkTranslatePrompt(family)],
      [`verify ${family}`, sf1UkVerifyPrompt(family)],
    ],
  );

describe('Starfield Ukrainian prompts', () => {
  it('has a translate and a verify prompt of its own for every family', () => {
    const prompts = everyPrompt().map(([, text]) => text);
    for (const text of prompts) expect(text.length).toBeGreaterThan(1_000);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('reads a mixed batch, a missing family and MCM as names and interface', () => {
    for (const family of ['default', 'mcm'] satisfies LlmPromptFamily[]) {
      expect(sf1UkTranslatePrompt(family)).toBe(sf1UkTranslatePrompt('item'));
      expect(sf1UkVerifyPrompt(family)).toBe(sf1UkVerifyPrompt('item'));
    }
    expect(sf1UkTranslatePrompt()).toBe(sf1UkTranslatePrompt('item'));
    expect(buildUkrainianTranslateSystemPrompt('en', 'sf1')).toBe(sf1UkTranslatePrompt('item'));
    expect(buildUkrainianVerifySystemPrompt('en', 'sf1', null)).toBe(sf1UkVerifyPrompt('item'));
  });

  it('is what the pipeline sends for a Starfield batch of that family', () => {
    for (const family of SF1_PROMPT_FAMILIES) {
      expect(buildUkrainianTranslateSystemPrompt('en', 'sf1', family)).toBe(
        sf1UkTranslatePrompt(family),
      );
      expect(buildUkrainianVerifySystemPrompt('en', 'sf1', family)).toBe(sf1UkVerifyPrompt(family));
    }
  });

  it.each(everyPrompt())('%s carries no Fallout vocabulary', (_name, text) => {
    for (const word of FALLOUT_VOCABULARY) expect(text).not.toContain(word);
    expect(text).toContain('Starfield');
  });

  it.each(everyPrompt())('%s names the terms that are easiest to get wrong', (_name, text) => {
    for (const term of [
      "Constellation → Сузір'я",
      "United Colonies → Об'єднані Колонії",
      'Freestar Collective → Колектив Вільних Зірок',
      'Starborn → Зоренароджені',
      'Spacers → космоброди',
      'Grav Drive → грав-рушій',
      'credits → кредити',
      'damage → шкода',
      'Rifle → гвинтівка',
    ]) {
      expect(text).toContain(term);
    }
    // The request's glossary is the canon; the seed is never dumped into the prompt.
    expect(text).toContain('"glossary"');
    expect(text).not.toContain('"term":');
  });

  it("keeps the player's gender out of a dialogue line, both ways", () => {
    for (const text of [sf1UkTranslatePrompt('dialog'), sf1UkVerifyPrompt('dialog')]) {
      expect(text).toContain('Герой без голосу, один текст на всіх гравців');
      expect(text).toContain('`speaker_gender: "any"`');
      expect(text).toContain('`addressee_gender: "any"`');
      expect(text).toContain('лише щоб сховати рід');
      expect(text).toContain('"капітане" (не "капітанко")');
    }
  });

  it('picks «ти» or «ви» by character, never as a way to hide gender', () => {
    for (const family of ['dialog', 'prose'] as const) {
      const text = sf1UkTranslatePrompt(family);
      expect(text).toContain('за персонажем і стосунками');
      expect(text).toContain('за правилами гри для цього персонажа');
      expect(text).toMatch(/\*\*Ти\*\*: Сузір'я/u);
      expect(text).toMatch(/\*\*Ви\*\*: влада й командування ОК/u);
      // The formal-register games tell the model to fall back on the plural.
      expect(text).not.toContain('«ви»+множина або безособове');
    }
  });

  it('gives each family the rules of its own kind of text', () => {
    expect(sf1UkTranslatePrompt('dialog')).toContain('[Persuade] → [Переконати]');
    expect(sf1UkTranslatePrompt('prose')).toContain('ITXT — пункт меню');
    expect(sf1UkTranslatePrompt('quest')).toContain("(Optional) → (Необов'язково)");
    expect(sf1UkTranslatePrompt('quest')).toContain('від першої особи героя й **без роду**');
    expect(sf1UkTranslatePrompt('item')).toContain('Один шаблон на серію');
    expect(sf1UkTranslatePrompt('face')).toContain('Torso → Тулуб');
    for (const [en, uk] of SF1_UK_INTERACTION_VERBS) {
      expect(sf1UkTranslatePrompt('item')).toContain(`${en} → ${uk}`);
      expect(sf1UkVerifyPrompt('item')).toContain(`${en} → ${uk}`);
    }
    // Names and labels are not a place for register or character voice.
    for (const family of ['item', 'face'] as const) {
      expect(sf1UkTranslatePrompt(family)).not.toContain('**Голоси**');
      expect(sf1UkTranslatePrompt(family)).not.toContain('Рід за метаданими');
    }
  });

  it('spends fewer characters than Fallout 4 on dialogue, prose and quests', () => {
    for (const family of ['dialog', 'prose', 'quest'] as const) {
      expect(sf1UkTranslatePrompt(family).length).toBeLessThan(fo4UkTranslatePrompt(family).length);
      expect(sf1UkVerifyPrompt(family).length).toBeLessThan(fo4UkVerifyPrompt(family).length);
    }
  });

  it.each(SF1_UK_DIALOG_EXAMPLES.map((example) => [example.parts.join('…'), example] as const))(
    'shows an answer that marks no gender it was not given: %s',
    (_source, example) => {
      const answer = example.answer.filter((part) => typeof part === 'string').join(' ');
      const leaks = findUkrainianGenderConflicts(answer, {
        speakerGender: example.speaker_gender as SpeakerGender,
        addresseeGender: example.addressee_gender as SpeakerGender,
      });
      expect(leaks.map((leak) => leak.form)).toEqual([]);
      expect(answer).not.toMatch(/[«»]/u);
    },
  );
});

describe('Starfield rule bullets', () => {
  it('no longer tells other languages to address the player formally', () => {
    const rules = buildEnglishTranslationRules('pl', 'sf1');
    expect(rules).toContain('never switch to the formal or plural "you" only to hide gender');
    expect(rules).toContain('Informal "you": Constellation');
    expect(rules).not.toMatch(/often addressed as "Captain"/u);
  });

  it('keeps the Ukrainian bullets on the same canon as the prompts', () => {
    const uk = [...sf1Rules.uk(), ...(sf1Rules.verifyUk?.() ?? [])].join('\n');
    for (const word of FALLOUT_VOCABULARY) expect(uk).not.toContain(word);
    expect(uk).toContain('за персонажем і стосунками');
    expect(uk).not.toMatch(/завжди «ви»/u);
  });
});

describe('Starfield glossary seed', () => {
  const byTerm = new Map(SF1_UK_GLOSSARY.map((entry) => [entry.term, entry.translation]));

  it('holds the core of the canon, one rendering per term', () => {
    expect(SF1_UK_GLOSSARY.length).toBeGreaterThan(150);
    expect(byTerm.size).toBe(SF1_UK_GLOSSARY.length);
    for (const { term, translation } of SF1_UK_GLOSSARY) {
      expect(term).toBe(term.trim());
      expect(translation.trim().length).toBeGreaterThan(0);
      expect(translation).not.toMatch(/[\/;(]|«|»/u);
    }
  });

  it('carries the decisions the draft had wrong or lacked', () => {
    expect(byTerm.get('Constellation')).toBe("Сузір'я");
    expect(byTerm.get('United Colonies')).toBe("Об'єднані Колонії");
    expect(byTerm.get('Freestar Collective')).toBe('Колектив Вільних Зірок');
    expect(byTerm.get('Starborn')).toBe('Зоренароджені');
    expect(byTerm.get('Spacers')).toBe('космоброди');
    expect(byTerm.get('grav drive')).toBe('грав-рушій');
    expect(byTerm.get('credits')).toBe('кредити');
    expect(byTerm.get('damage')).toBe('шкода');
    expect(byTerm.get('rifle')).toBe('гвинтівка');
  });

  it('matches a common noun in any case and a proper noun only as written', () => {
    expect(glossaryTermMatchesSource('Grav Drive', 'grav drive')).toBe(true);
    expect(glossaryTermMatchesSource('Assault Rifle', 'rifle')).toBe(true);
    expect(glossaryTermMatchesSource('a temple of sorts', 'Temple')).toBe(false);
    // Terms the matcher would read as an everyday word are left to the name canon.
    for (const term of ['LIST', 'EM', 'UC', 'pack', 'Sol']) expect(byTerm.has(term)).toBe(false);
  });
});
