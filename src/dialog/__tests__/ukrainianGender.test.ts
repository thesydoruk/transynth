import { detectUkrainianGenderMarkers, findUkrainianGenderConflicts } from '../ukrainianGender';

describe('detectUkrainianGenderMarkers', () => {
  it('reads the gender of a past-tense verb after «я»', () => {
    expect(detectUkrainianGenderMarkers('Я сказала їм правду.')).toEqual([
      { person: 1, gender: 'female', form: 'сказала' },
    ]);
    expect(detectUkrainianGenderMarkers('Я сказав їм правду.')).toEqual([
      { person: 1, gender: 'male', form: 'сказав' },
    ]);
  });

  it('reads a predicative adjective addressed to «ти»', () => {
    expect(detectUkrainianGenderMarkers('Ти готова?')).toEqual([
      { person: 2, gender: 'female', form: 'готова' },
    ]);
  });

  it('looks past fillers between the pronoun and the verb', () => {
    expect(detectUkrainianGenderMarkers('Я вже не бачив цього.')).toEqual([
      { person: 1, gender: 'male', form: 'бачив' },
    ]);
  });

  it('reads a verb that precedes its pronoun', () => {
    expect(detectUkrainianGenderMarkers('Знайшла я цей ключ.')).toEqual([
      { person: 1, gender: 'female', form: 'знайшла' },
    ]);
  });

  it('stops at a preposition so nouns are not read as verbs', () => {
    expect(detectUkrainianGenderMarkers('Я на острів не поїду.')).toEqual([]);
  });

  it('ignores nouns that merely look like past-tense forms', () => {
    expect(detectUkrainianGenderMarkers('Я кров бачу.')).toEqual([]);
    expect(detectUkrainianGenderMarkers('Ти сила.')).toEqual([]);
  });

  it('ignores gendered wording with no participant pronoun', () => {
    expect(detectUkrainianGenderMarkers('Вартовий побачив нас.')).toEqual([]);
  });

  it('reports each distinct form once', () => {
    expect(detectUkrainianGenderMarkers('Я прийшла, і я прийшла сама.')).toEqual([
      { person: 1, gender: 'female', form: 'прийшла' },
    ]);
  });

  it('does not treat genitive plurals before «я» as inverted verbs', () => {
    expect(detectUkrainianGenderMarkers('Через синтів я часто почуваюся застарілою.')).toEqual([]);
    expect(detectUkrainianGenderMarkers('Скільки разів я маю це повторювати?')).toEqual([]);
  });

  it('does not attach a verb across punctuation to «я»', () => {
    expect(
      detectUkrainianGenderMarkers(
        'Через те, що мати постійно кричала, я майже нічого не чую цим вухом.',
      ),
    ).toEqual([]);
  });

  it('does not read verbs next to «тобі/тебе» as addressee agreement', () => {
    expect(detectUkrainianGenderMarkers('Я ж казала тобі не називати мене так!')).toEqual([
      { person: 1, gender: 'female', form: 'казала' },
    ]);
    expect(detectUkrainianGenderMarkers('Рада тебе бачити.')).toEqual([]);
  });
});

describe('findUkrainianGenderConflicts', () => {
  it('flags a form that contradicts the speaker', () => {
    expect(
      findUkrainianGenderConflicts('Я була там.', {
        speakerGender: 'male',
        addresseeGender: 'unknown',
      }),
    ).toEqual([{ role: 'speaker', expected: 'male', found: 'female', form: 'була' }]);
  });

  it('accepts a form that agrees with the speaker', () => {
    expect(
      findUkrainianGenderConflicts('Я була там.', {
        speakerGender: 'female',
        addresseeGender: 'unknown',
      }),
    ).toEqual([]);
  });

  it('flags any committed form for the player character', () => {
    expect(
      findUkrainianGenderConflicts('Ти готовий?', {
        speakerGender: 'male',
        addresseeGender: 'any',
      }),
    ).toEqual([{ role: 'addressee', expected: 'any', found: 'male', form: 'готовий' }]);
  });

  it('stays silent when the participant gender is unknown', () => {
    expect(
      findUkrainianGenderConflicts('Я була там.', {
        speakerGender: 'unknown',
        addresseeGender: 'unknown',
      }),
    ).toEqual([]);
  });

  it('reports the speaker and the addressee separately', () => {
    expect(
      findUkrainianGenderConflicts('Я був упевнений, що ти готова.', {
        speakerGender: 'female',
        addresseeGender: 'male',
      }),
    ).toEqual([
      { role: 'speaker', expected: 'female', found: 'male', form: 'був' },
      { role: 'addressee', expected: 'male', found: 'female', form: 'готова' },
    ]);
  });
});
