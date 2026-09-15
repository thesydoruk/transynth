import { describe, expect, it } from '@jest/globals';
import {
  describeUkrainianCalques,
  findUkrainianCalques,
  promptCalqueRules,
  ukrainianCalqueRules,
} from '../ukrainianCalques';

const ids = (text: string): string[] => findUkrainianCalques(text).map((match) => match.rule.id);

describe('findUkrainianCalques', () => {
  it('catches the English tag question', () => {
    expect(ids('Це небезпечно, чи не так?')).toEqual(['tag_question']);
    expect(ids('Гарно вийшло, чи не так ?')).toEqual(['tag_question']);
  });

  it('catches an explicit copula where Ukrainian drops it', () => {
    expect(ids('Я є механіком цього поселення.')).toContain('copula_ye');
    expect(ids('Це є пастка.')).toContain('copula_ye');
  });

  it('leaves the copula alone where it is a real verb of existence', () => {
    // Every line here is a real translation the first draft of this rule flagged.
    expect(ids('У нас є вода.')).not.toContain('copula_ye');
    expect(ids('Питання в тому, чи є що їсти.')).not.toContain('copula_ye');
    expect(ids('Бачите, на це є дві реакції.')).not.toContain('copula_ye');
    expect(ids('І за це є лише одне покарання.')).not.toContain('copula_ye');
    expect(ids('Залиште це місце таким, як воно є зараз.')).not.toContain('copula_ye');
    expect(ids('Вони зробили мене тією, ким я є сьогодні.')).not.toContain('copula_ye');
  });

  it('catches phrases that only exist because English has them', () => {
    expect(ids('Я ціную це.')).toEqual(['appreciate_it']);
    expect(ids('Треба взяти турботу про генератор.')).toEqual(['take_care_of']);
    expect(ids('Ти можеш зробити різницю.')).toEqual(['make_a_difference']);
    expect(ids('Це залежить від тебе.')).toEqual(['up_to_you']);
    expect(ids('Ти в порядку?')).toEqual(['are_you_okay']);
    expect(ids('Немає проблем.')).toEqual(['no_problem']);
    expect(ids('Він є членом загону.')).toEqual(['copula_ye']);
    expect(ids('Не хвилюйся про це.')).toEqual(['do_not_worry_about_it']);
    expect(ids('Тримайся там, друже.')).toEqual(['hang_in_there']);
  });

  it('reads "at the end of the day" figuratively, not literally', () => {
    expect(ids('У кінці дня це нічого не змінює.')).toEqual(['end_of_the_day']);
    expect(ids('У кінці дня ми повернемося до табору.')).toEqual([]);
  });

  it('passes clean Ukrainian', () => {
    expect(ids('Усе гаразд?')).toEqual([]);
    expect(ids('Тобі вирішувати.')).toEqual([]);
    expect(ids('Зрештою це нічого не змінює.')).toEqual([]);
    expect(ids('Валіть звідси, поки цілі.')).toEqual([]);
    expect(ids('')).toEqual([]);
  });

  it('reads "no problem" as a reply, not as a statement about problems', () => {
    expect(ids('Немає проблем. Заходь коли завгодно.')).toEqual(['no_problem']);
    expect(ids('То з енергією більше немає проблем?')).toEqual([]);
    expect(ids('Сподіваюся, у тебе немає проблем.')).toEqual([]);
  });

  it('checks more rules than it spends prompt space on', () => {
    const prompt = promptCalqueRules();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.length).toBeLessThan(ukrainianCalqueRules().length);
    // The one the user named as the example has to be in the prompt.
    expect(prompt.map((rule) => rule.id)).toContain('tag_question');
    expect(prompt.every((rule) => rule.inPrompt)).toBe(true);
  });

  it('describes what was found and what to say instead', () => {
    const message = describeUkrainianCalques(findUkrainianCalques('Це небезпечно, чи не так?'));
    expect(message).toContain('чи не так?');
    expect(message).toContain("isn't it?");
    expect(message).toContain('еге ж?');
  });
});
