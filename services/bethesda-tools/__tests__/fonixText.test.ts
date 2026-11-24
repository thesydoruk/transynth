import { describe, expect, it } from '@jest/globals';
import {
  AUDIO_ONLY_TEXT,
  prepareLipGeneratorText,
  respellUkrainian,
  stripToneTags,
} from '../fonixText';

// The self-test vectors of thesydoruk/FaceFXWrapper `FFXW32/Ukrainian.cpp`, which the
// Fallout titles' `.lip` path runs: the Starfield path must spell the same way.
describe('respellUkrainian (FaceFXWrapper vectors)', () => {
  it.each([
    ['Hello, vault dweller.', 'Hello, vault dweller.'],
    ['привіт', 'prihveet'],
    ['ні', 'nee'],
    ['це', 'tseh'],
    ['що', 'shchoh'],
    ['їжа', 'yeezhah'],
    ['ґава', 'gahvah'],
    ['дякую', 'dyahkooyoo'],
    ['Pip-Boy працює', 'Pip-Boy prahtsyooyeh'],
    ["з'їсти", 'zyeestih'],
    ['джерело', 'jehrehloh'],
    ['дзвін', 'dzveen'],
    ['сьогодні', 'syohohdnee'],
    ['нього', 'nyohoh'],
    ['його', 'yohoh'],
    ['хліб', 'hleeb'],
    ['сіль', 'seel'],
  ])('%s → %s', (input, expected) => {
    expect(respellUkrainian(input)).toBe(expected);
  });

  it('keeps capitals on the first letter of a mapped cluster', () => {
    expect(respellUkrainian('Джерело Йоган Ящик')).toBe('Jehrehloh Yohahn Yahshchihk');
  });

  it('drops typographic apostrophes too', () => {
    expect(respellUkrainian('м’ята сім`я')).toBe('myahtah seemyah');
  });
});

describe('stripToneTags', () => {
  it('drops bracketed blocks and stray brackets', () => {
    expect(stripToneTags('[Сарказм] Привіт, [пауза] мешканцю.')).toBe('Привіт, мешканцю.');
    expect(stripToneTags('Так] і [ні')).toBe('Так і ні');
  });
});

describe('prepareLipGeneratorText', () => {
  it('strips tags then respells, as the wrapper does for Ukrainian', () => {
    expect(prepareLipGeneratorText('[Сарказм] Привіт, мешканцю.')).toEqual({
      text: 'Prihveet, mehshkahntsyoo.',
      guided: true,
    });
  });

  it('passes English through', () => {
    expect(prepareLipGeneratorText('Welcome to New Atlantis.')).toEqual({
      text: 'Welcome to New Atlantis.',
      guided: true,
    });
  });

  it('falls back to the audio-only stand-in when nothing readable is left', () => {
    for (const raw of ['', '   ', '[Сміється]', '...', '— — —', '"']) {
      expect(prepareLipGeneratorText(raw)).toEqual({ text: AUDIO_ONLY_TEXT, guided: false });
    }
  });

  it('never starts with a dash (an option) and carries no double quotes or controls', () => {
    expect(prepareLipGeneratorText('— Ні, "друже".\n-Так').text).toBe('Nee, droozheh. -Tahk');
    expect(prepareLipGeneratorText('-OutputFileName:x').text).toBe('OutputFileName:x');
  });
});
