import { describe, expect, it } from '@jest/globals';
import {
  prepareVoiceTtsText,
  resolveVoiceLineSkipReason,
} from '../../../voice/prepareVoiceTtsText';
import { WITCHER3_VOICE_MARKUP } from '../voice/markup';

const prepare = (source: string, translation: string) =>
  prepareVoiceTtsText({
    lineSource: source,
    translation,
    speakerSource: source,
    markup: WITCHER3_VOICE_MARKUP,
  });

const skipReason = (source: string, translation: string) =>
  resolveVoiceLineSkipReason(source, translation, null, WITCHER3_VOICE_MARKUP);

// Every pair below is a voiced line of the game with its reviewed translation.
describe('Witcher 3 stage directions', () => {
  it('does not speak a line whose source is only a sound', () => {
    expect(skipReason('*Whistles*', 'Ф’ю-у-у.')).toBe('non_speech_marker');
    expect(skipReason('*Merry whistling*', 'Ф’ю, ф’ю, ф’ю.')).toBe('non_speech_marker');
    expect(skipReason('*Snorts*', '*Харкає*')).toBe('non_speech_marker');
  });

  it('does not speak a sound written inside Elder Speech braces', () => {
    expect(skipReason('{*Whistles*}', 'Ф’ю-у-у.')).toBe('non_speech_marker');
    expect(skipReason('{*Sob sob sniff sniff*}', 'Хник-хник.')).toBe('non_speech_marker');
    expect(skipReason('{*Whistles a melody*}', '*Насвистує мелодію*')).toBe('non_speech_marker');
  });

  it('does not speak a direction the translator wrote for a spelled-out sound', () => {
    expect(skipReason('Yaaaaawn…', '*Позіхає*')).toBe('non_speech_marker');
    expect(skipReason('Blhrrrraaagh bleugh hrrleugh…', '*Блює*')).toBe('non_speech_marker');
  });

  it('does not speak a sound left with only punctuation or a grunt around it', () => {
    expect(skipReason('*Violent choking cough*!', 'Кхе-кхе-кхе!')).toBe('phonetic_vocalization');
    expect(skipReason('*Sniff sniff sniff* Eurgh.', '*Шморгає* Фу.')).toBe('phonetic_vocalization');
  });

  it('speaks the words around a direction and keeps it out of both texts', () => {
    expect(prepare("All right. *Spits* Give 'er here.", 'Ну нехай. Тьху. Давай сюди.')).toEqual({
      action: 'synthesize',
      text: 'Ну нехай. Тьху. Давай сюди.',
      speakerText: "All right. Give 'er here.",
    });
    expect(prepare('Mff… Smell of a rotting corpse.', '*Нюхає* Смердить зогнилим трупом.')).toEqual(
      {
        action: 'synthesize',
        text: 'Смердить зогнилим трупом.',
        speakerText: 'Mff… Smell of a rotting corpse.',
      },
    );
  });

  it('leaves Elder Speech as it was: the braced words are spoken, the gloss is not', () => {
    expect(prepare('{A’anval!} [Attack!]', '{A’anval!} [В атаку!]')).toEqual({
      action: 'synthesize',
      text: '{A’anval!}',
      speakerText: '{A’anval!}',
    });
    expect(
      prepare(
        '{*Cough*… Gláeddyv… Thomh gláeddyv a me! } [*Cough* Sword… Give me my sword!]',
        '{*Cough*… Gláeddyv… Thomh gláeddyv a me!} [Кхе. Меч... Дай мій меч!]',
      ),
    ).toMatchObject({ action: 'synthesize', text: '{ … Gláeddyv… Thomh gláeddyv a me!}' });
  });
});
