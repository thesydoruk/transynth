import { describe, expect, it } from '@jest/globals';
import {
  describeGenderLeaks,
  genderAgreementInstruction,
  isPlayerGenderConflict,
  findGenderLeaks,
  genderRetryInstruction,
  isGenderGuardLanguage,
} from '../genderGuard';
import type { LlmDialogParticipants } from '../dialogParticipants';

const player: LlmDialogParticipants = { speaker_gender: 'any', addressee_gender: 'male' };

describe('isGenderGuardLanguage', () => {
  it('recognises Ukrainian however it is spelled in the job', () => {
    expect(isGenderGuardLanguage('uk')).toBe(true);
    expect(isGenderGuardLanguage(' UK ')).toBe(true);
  });

  it('is off for every other target', () => {
    expect(isGenderGuardLanguage('pl')).toBe(false);
    expect(isGenderGuardLanguage('ukr')).toBe(false);
    expect(isGenderGuardLanguage(null)).toBe(false);
    expect(isGenderGuardLanguage(undefined)).toBe(false);
  });
});

describe('findGenderLeaks', () => {
  it('catches a masculine past tense in a line the player may speak', () => {
    const leaks = findGenderLeaks('Я подбав про них.', player, 'uk');
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toMatchObject({ role: 'speaker', found: 'male', expected: 'any' });
  });

  it('catches a feminine one just the same', () => {
    const leaks = findGenderLeaks('Я подбала про них.', player, 'uk');
    expect(leaks[0]).toMatchObject({ role: 'speaker', found: 'female', expected: 'any' });
  });

  it('passes a line phrased so the gender does not show', () => {
    expect(findGenderLeaks('Про них подбали.', player, 'uk')).toEqual([]);
    expect(findGenderLeaks('Уже роблю.', player, 'uk')).toEqual([]);
  });

  it('catches a form that contradicts a known speaker', () => {
    const leaks = findGenderLeaks('Я знайшла це в підвалі.', { speaker_gender: 'male' }, 'uk');
    expect(leaks[0]).toMatchObject({ role: 'speaker', found: 'female', expected: 'male' });
  });

  it('leaves a form that agrees with a known speaker alone', () => {
    expect(findGenderLeaks('Я знайшов це в підвалі.', { speaker_gender: 'male' }, 'uk')).toEqual(
      [],
    );
  });

  it('says nothing when the metadata says nothing to contradict', () => {
    expect(findGenderLeaks('Я подбав про них.', {}, 'uk')).toEqual([]);
    expect(findGenderLeaks('Я подбав про них.', { speaker_gender: 'unknown' }, 'uk')).toEqual([]);
  });

  it('is inert outside Ukrainian and on empty text', () => {
    expect(findGenderLeaks('Я подбав про них.', player, 'pl')).toEqual([]);
    expect(findGenderLeaks('   ', player, 'uk')).toEqual([]);
  });
});

describe('describeGenderLeaks', () => {
  it('explains a player-chosen gender differently from a mismatched one', () => {
    const hidden = describeGenderLeaks(findGenderLeaks('Я подбав про них.', player, 'uk'));
    expect(hidden).toContain('«подбав»');
    expect(hidden).toContain('обирає гравець');

    const wrong = describeGenderLeaks(
      findGenderLeaks('Я знайшла це.', { speaker_gender: 'male' }, 'uk'),
    );
    expect(wrong).toContain('не збігається');
    expect(wrong).toContain('male');
  });

  it('names a repeated form once and distinct forms separately', () => {
    expect(describeGenderLeaks(findGenderLeaks('Я подбав, я справді подбав.', player, 'uk'))).toBe(
      describeGenderLeaks(findGenderLeaks('Я подбав про них.', player, 'uk')),
    );

    const both = describeGenderLeaks(
      findGenderLeaks('Я подбав про них. Я все зробив.', player, 'uk'),
    );
    expect(both).toContain('«подбав»');
    expect(both).toContain('«зробив»');
  });
});

describe('genderRetryInstruction', () => {
  it('names the forms and rules out the shortcuts', () => {
    const instruction = genderRetryInstruction(findGenderLeaks('Я подбав про них.', player, 'uk'));
    expect(instruction).toContain('«подбав»');
    expect(instruction).toContain('слеш');
    expect(instruction).toContain('«ви»');
  });
});

describe('telling the two kinds of gender failure apart', () => {
  const conflict = (expected: 'any' | 'male' | 'female') =>
    ({ role: 'speaker', expected, found: 'male', form: 'вирішив' }) as const;

  it('calls it the player when every objection is about a gender they pick', () => {
    expect(isPlayerGenderConflict([conflict('any')])).toBe(true);
    expect(isPlayerGenderConflict([conflict('any'), conflict('any')])).toBe(true);
  });

  it('calls it agreement when a known gender is involved', () => {
    expect(isPlayerGenderConflict([conflict('female')])).toBe(false);
    // Mixed: one role is known, so the line cannot simply be neutralised.
    expect(isPlayerGenderConflict([conflict('any'), conflict('female')])).toBe(false);
  });

  it('says nothing about an empty list', () => {
    expect(isPlayerGenderConflict([])).toBe(false);
  });

  it('asks for the gender rather than for a rephrase', () => {
    const instruction = genderAgreementInstruction([conflict('female')]);
    expect(instruction).toContain('«вирішив»');
    expect(instruction).toContain('жіночий');
    expect(instruction).toContain('Не перефразовуй');
  });
});
