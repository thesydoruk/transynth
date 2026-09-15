import { describe, expect, it } from '@jest/globals';
import { collectPronounEvidence, decideGender } from '../pronounEvidence';

describe('collectPronounEvidence', () => {
  it('reads a character the mod refers to by pronoun', () => {
    const texts = [
      "Jake said he'd meet us at the settlement.",
      'Talk to Jake. His crew handles the water.',
      'I sent Jake ahead, he knows the route.',
      'Jake fixed the pump himself.',
      'Ask Jake. He was on shift.',
      'Jake left his tools by the gate.',
    ];
    expect(collectPronounEvidence('Jake', texts)).toMatchObject({ gender: 'male' });
  });

  it('works the same for a name no list would contain', () => {
    const texts = [
      "Ask J'zargo about it. She was there when it happened.",
      "J'zargo left her notes on the table.",
      "J'zargo apologised, sort of. Her spell nearly killed us.",
      "J'zargo is not here. She went to the college.",
      "That is J'zargo's doing. Her magic, her mess.",
      "J'zargo warned us. She always does.",
    ];
    expect(collectPronounEvidence("J'zargo", texts)).toMatchObject({ gender: 'female' });
  });

  it('stays unknown when the mentions are split', () => {
    const texts = [
      'Ada-Soon told me he would come.',
      'Ada-Soon said she was busy.',
      'I saw Ada-Soon. He waved.',
      'Ada-Soon and her guards left.',
    ];
    expect(collectPronounEvidence('Ada-Soon', texts).gender).toBe('unknown');
  });

  it('stays unknown on thin evidence', () => {
    expect(collectPronounEvidence('Edmund', ['Edmund is late. He always is.']).gender).toBe(
      'unknown',
    );
  });

  it('refuses a personified abstraction that a few stray pronouns brush past', () => {
    // Measured on Disco Elysium: `Conceptualization` and `Drama` are speakers,
    // and three "he"s in sentences that merely contain the word were enough to
    // call them male at the old bar. Both are feminine nouns in Ukrainian.
    const texts = [
      'Conceptualization: he is making a scene, and it is beautiful.',
      'Conceptualization tells you he meant every word.',
      'A flash of Conceptualization — he could have been an artist.',
      'Conceptualization: his coat, his posture, all of it composed.',
      'Drama: he is lying to you.',
    ];
    expect(collectPronounEvidence('Conceptualization', texts).gender).toBe('unknown');
    expect(collectPronounEvidence('Drama', texts).gender).toBe('unknown');
  });

  it('counts a pronoun in the sentence right after the name', () => {
    expect(
      collectPronounEvidence('Sickle', ['Sickle runs the caravan. He has for years.']),
    ).toMatchObject({ male: 1, female: 0 });
  });

  it('ignores a pronoun further off than that, however short the sentences', () => {
    const far = 'Sickle runs the caravan. Been that way a while. She is the one I meant.';
    expect(collectPronounEvidence('Sickle', [far])).toMatchObject({ male: 0, female: 0 });
  });

  it('treats a run of terminators as one sentence break', () => {
    // "..." must not burn the whole allowance the way three full stops would.
    expect(
      collectPronounEvidence('Sickle', ['Sickle just stood there... He said nothing.']),
    ).toMatchObject({ male: 1 });
  });

  it('does not match a name inside a longer word', () => {
    expect(collectPronounEvidence('Ron', ['The electron he measured was unstable.'])).toMatchObject(
      {
        male: 0,
      },
    );
  });

  it('matches regardless of case', () => {
    const texts = [
      'LYDIA said she would wait.',
      'lydia knows her way around.',
      'Lydia, her call.',
      'Ask LyDiA — she runs the shop.',
      'Lydia took her share.',
      'lydia said she was fine.',
    ];
    expect(collectPronounEvidence('Lydia', texts).gender).toBe('female');
  });

  it('refuses to work from a name too short to be distinctive', () => {
    expect(collectPronounEvidence('Al', ['Al said he would come. Al. He. Al he.'])).toEqual({
      male: 0,
      female: 0,
      gender: 'unknown',
    });
  });
});

describe('decideGender', () => {
  it('needs a clear majority and enough mentions', () => {
    expect(decideGender(6, 0)).toBe('male');
    expect(decideGender(0, 6)).toBe('female');
    // 10:4 is 71% male — just over the bar, which is where Cassandra-style noise sits.
    expect(decideGender(10, 4)).toBe('male');
    expect(decideGender(45, 1)).toBe('male');
    // Below the bar an abstraction brushed by a few pronouns stays unknown.
    expect(decideGender(3, 0)).toBe('unknown');
    expect(decideGender(5, 0)).toBe('unknown');
    expect(decideGender(0, 0)).toBe('unknown');
  });
});
