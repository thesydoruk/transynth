import { describe, expect, it } from '@jest/globals';
import type { SpeakerGender } from '../../dialog/gender';
import { findUkrainianGenderConflicts } from '../../dialog/ukrainianGender';
import {
  buildUkGenderTranslateRules,
  buildUkGenderVerifyRules,
  type UkPlayerRegister,
} from '../prompts/genderRules';
import { UK_PER_CHARACTER_GENDER_RECAST_ITEMS } from '../prompts/genderRulesPerCharacter';
import { buildUkrainianTranslateRules, buildUkrainianVerifyRules } from '../prompts/ukrainianRules';

/** Everything in the Fallout 4 register that belongs to Fallout 4 alone. */
const FALLOUT_ONLY = [
  'Нейт',
  'Нор',
  'Шон',
  'Інститут',
  'Піп-бой',
  'пустк',
  'Сховищ',
  'Співдружн',
  'Кодсворт',
  'Престон',
  'Nate',
  'Nora',
  'Codsworth',
  'Institute',
  'Vault',
  'Preston',
  'Danse',
  'Hancock',
  'Cooke',
  'Silver Shroud',
  'Cito',
  'RNAM',
];

const perCharacter = (): Array<[string, string]> => [
  ['translate', buildUkGenderTranslateRules('гравець', 'per-character')],
  ['verify', buildUkGenderVerifyRules('гравець', 'per-character')],
  ['translate with calques', buildUkrainianTranslateRules('гравець', 'per-character')],
  ['verify with calques', buildUkrainianVerifyRules('гравець', 'per-character')],
];

describe('per-character player register', () => {
  it.each(perCharacter())('%s rules name no Fallout character or place', (_name, rules) => {
    for (const word of FALLOUT_ONLY) expect(rules).not.toContain(word);
  });

  it('leaves «ти» / «ви» to the game and forbids the polite plural as a gender crutch', () => {
    const translate = buildUkGenderTranslateRules('гравець', 'per-character');
    expect(translate).toContain('за правилами гри для цього персонажа');
    expect(translate).toContain('Рід ховай перефразом, не ввічливістю');
    expect(translate).toContain('«ви»/«будьте» замість «ти» лише щоб сховати рід');
    expect(translate).toContain('Не ховай рід через «ви»');
    // The formal register's advice is exactly what this one rules out.
    expect(translate).not.toContain('«ви»+множина або безособове');
    expect(translate).not.toContain('«Ви прекрасні, золотко.»');

    const verify = buildUkGenderVerifyRules('гравець', 'per-character');
    expect(verify).toContain('коли так говорить цей персонаж за правилами гри');
    expect(verify).toContain('«ви»/«будьте» лише щоб сховати рід');
  });

  it('keeps the rules every register shares', () => {
    const translate = buildUkGenderTranslateRules('гравець', 'per-character');
    expect(translate).toContain('**Рід за метаданими (КРИТИЧНО, гравець)**');
    expect(translate).toContain('`speaker_gender: "female"` → перша особа в жіночому роді');
    expect(translate).toContain('**Третя особа**');
    expect(buildUkGenderVerifyRules('гравець', 'per-character')).toContain(
      'Розбіжність із "male"/"female" → **"incorrect"**',
    );
  });

  it('is a third register beside the two it must not disturb', () => {
    const registers: UkPlayerRegister[] = ['formal-vy', 'wasteland-ty', 'per-character'];
    const texts = registers.map((register) => buildUkGenderTranslateRules('гравець', register));
    expect(new Set(texts).size).toBe(3);
    expect(buildUkGenderTranslateRules('гравець')).toBe(texts[0]);
    expect(texts[0]).toContain('«ви»+множина або безособове');
    expect(texts[1]).toContain('пустка на ти');
    expect(texts[1]).toContain('спільний рядок Нейта/Нори');
    expect(texts[1]).toContain('«любий Піп-бой»');
    expect(texts[0]).toContain('«любий Піп-бой»');
  });
});

describe('per-character recast examples', () => {
  const items = UK_PER_CHARACTER_GENDER_RECAST_ITEMS as ReadonlyArray<{
    source: string;
    translation: string;
    bad?: readonly string[];
    note?: string;
    speaker_gender?: string;
    addressee_gender?: string;
  }>;
  const participants = (item: (typeof items)[number]) => ({
    speakerGender: (item.speaker_gender ?? 'unknown') as SpeakerGender,
    addresseeGender: (item.addressee_gender ?? 'unknown') as SpeakerGender,
  });

  it.each(items.map((item) => [`${item.source} ${item.note ?? ''}`.trim(), item] as const))(
    'shows an answer the detector accepts: %s',
    (_source, item) => {
      const leaks = findUkrainianGenderConflicts(item.translation, participants(item));
      expect(leaks.map((leak) => leak.form)).toEqual([]);
    },
  );

  it('never answers with a slash, and never repeats an answer', () => {
    for (const item of items) expect(item.translation).not.toMatch(/\p{L}\/\p{L}/u);
    const answers = items.map((item) => item.translation);
    expect(new Set(answers).size).toBe(answers.length);
  });

  it('shows the polite plural as wrong for a «ти» speaker and right for a «ви» one', () => {
    const [informal, formal] = items.filter((item) => item.source === 'Are you ready?');
    expect(informal?.note).toBe('мовець на «ти»');
    expect(informal?.bad).toContain('Ви готові?');
    expect(formal?.note).toBe('мовець на «ви»');
    expect(formal?.translation).toBe('Ви готові?');
  });
});
