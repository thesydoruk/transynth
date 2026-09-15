import { describe, it, expect } from '@jest/globals';
import type { SpeakerGender } from '../gender';
import { detectUnanchoredGenderForms, findUkrainianGenderConflicts } from '../ukrainianGender';

const forms = (text: string) => detectUnanchoredGenderForms(text).map((marker) => marker.form);

type Participants = { speakerGender: SpeakerGender; addresseeGender: SpeakerGender };
const PLAYER: Participants = { speakerGender: 'any', addresseeGender: 'any' };
const conflicts = (text: string, participants: Participants = PLAYER) =>
  findUkrainianGenderConflicts(text, participants).map((conflict) => conflict.form);

describe('detectUnanchoredGenderForms', () => {
  it('sees a predicate whose subject was dropped', () => {
    // Ukrainian drops the subject constantly; the anchored scan needs «я» or «ти».
    expect(forms('Зрозумів.')).toEqual(['зрозумів']);
    expect(forms('Не впевнений.')).toEqual(['впевнений']);
    expect(forms('Ще нікого не знайшов.')).toEqual(['знайшов']);
  });

  it('sees one inside a subordinate clause', () => {
    expect(forms('Дякую, що сказав.')).toEqual(['сказав']);
  });

  it('sees a dropped feminine subject too', () => {
    expect(forms('Передумала?')).toEqual(['передумала']);
  });

  it('leaves a form that agrees with a named subject', () => {
    expect(forms('Ерл був мертвий.')).toEqual([]);
    expect(forms('Генератор працював усю ніч.')).toEqual([]);
  });

  it('leaves a form whose subject follows it', () => {
    // Ukrainian puts the subject after the verb as readily as before it.
    expect(forms('Чи знищив Інститут Підземку?')).toEqual([]);
    expect(forms('Що зробив Інститут?')).toEqual([]);
    expect(forms('Саме те, що сказав би синт.')).toEqual([]);
  });

  it('leaves an attributive adjective alone', () => {
    expect(forms('Старий Стоктон.')).toEqual([]);
    expect(forms('Ще один робот.')).toEqual([]);
    expect(forms('Одна гарна ідея може все змінити.')).toEqual([]);
  });

  it('leaves a clause that inherits its subject from the one before', () => {
    expect(forms('Він привів тебе до нас, бо знав, що нам потрібна допомога.')).toEqual([]);
  });

  it('does not read a genitive plural as a verb', () => {
    // «синтів», «років», «доказів» — nominal in 361 of 372 corpus words on -ів.
    expect(forms('Синтів тут немає.')).toEqual([]);
    expect(forms('Доказів немає.')).toEqual([]);
  });

  it('still reads the few verbs that share that ending', () => {
    expect(forms('Зрозумів, дякую.')).toEqual(['зрозумів']);
  });

  it('keeps an object or an infinitive from passing as a subject', () => {
    expect(forms('Прийшов допомогти.')).toEqual(['прийшов']);
    expect(forms('Побачив щось на смак.')).toEqual(['побачив']);
  });
});

describe('unanchored forms against the participants', () => {
  it('reports a dropped subject when neither role could own it', () => {
    expect(conflicts('Зрозумів.')).toEqual(['зрозумів']);
  });

  it('reports it against the player when the other role rules it out', () => {
    // A female speaker cannot own a masculine form, so it is the player's.
    const found = findUkrainianGenderConflicts('Дякую, що сказав.', {
      speakerGender: 'female',
      addresseeGender: 'any',
    });
    expect(found).toEqual([{ role: 'addressee', expected: 'any', found: 'male', form: 'сказав' }]);
  });

  it('says nothing when a role could own the form', () => {
    expect(conflicts('Зрозумів.', { speakerGender: 'male', addresseeGender: 'any' })).toEqual([]);
    expect(conflicts('Зрозумів.', { speakerGender: 'unknown', addresseeGender: 'any' })).toEqual(
      [],
    );
  });

  it('says nothing when nobody is pinned down', () => {
    expect(
      conflicts('Зрозумів.', { speakerGender: 'unknown', addresseeGender: 'unknown' }),
    ).toEqual([]);
  });

  it('does not report the same form twice when the anchored scan already has it', () => {
    expect(conflicts('Я зрозумів. Зрозумів.')).toEqual(['зрозумів']);
  });
});

describe('predicative adjectives beside a pronoun', () => {
  it.each([
    ['Ти справжній герой.', 'справжній'],
    ['Ти приголомшений.', 'приголомшений'],
    ['Я новий хлопець.', 'новий'],
    ['Ти неабиякий розумник.', 'неабиякий'],
  ])('reads %s as pinning the participant down', (text, form) => {
    expect(conflicts(text)).toContain(form);
  });
});
