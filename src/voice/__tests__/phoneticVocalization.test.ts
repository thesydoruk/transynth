import { isPhoneticVocalizationLine, isWordlessSpokenLine } from '../phoneticVocalization';

describe('isPhoneticVocalizationLine', () => {
  it('matches combat and pain grunts from the audit', () => {
    for (const line of [
      'Agh!',
      'Oof!',
      'Nargh!',
      'Argh!',
      'Weergh!',
      'Ugh!',
      'Ugh...',
      'Gah!',
      'Aaargh!',
      'Ergh!',
      'Unf!',
      'Ungh.',
      'Hmph.',
      'Ahem.',
      'Pfft.',
      'Grunts...',
      'Grrargh!',
      'Nyyarrggh!',
      'Hhyyaarargghhhh!',
      'Nnh!',
      'Агх!',
      'Уф!',
      'Наргх!',
      'Грраргх!',
      'Ннх!',
    ]) {
      expect(isPhoneticVocalizationLine(line)).toBe(true);
    }
  });

  it('matches the combat barks and screams the voice types share', () => {
    for (const line of [
      'Nuh.',
      'Hunh!',
      'Yah!',
      'Yeagh!',
      'Hya!',
      'Hyah!!',
      'Huah!',
      'Kiah!',
      'Nyah!',
      'Keh!',
      'Umph..',
      'Rah!',
      'RAWR!',
      'Raarr!',
      'Ahh!',
      'Aaaah!',
      'AAHHHH!',
      'Augh...',
      'Hagh!',
      'Uragh!!!',
      'Hargh!',
      'Aaaayyyaarrrrgghh!',
      'Aaaa, aaaa, aaa!',
    ]) {
      expect(isPhoneticVocalizationLine(line)).toBe(true);
    }
  });

  it('keeps the words that only look like a bark', () => {
    for (const line of [
      'Yah?',
      'Nuh-uh.',
      'Hiya!',
      'Yeah.',
      'Nah.',
      'Huh?',
      'Enough!',
      'Tough.',
      'High.',
      'Rough...',
      'Yay!',
      'Aha!',
    ]) {
      expect(isPhoneticVocalizationLine(line)).toBe(false);
    }
  });

  it('matches fillers and laughs the user asked to skip', () => {
    for (const line of ['Hmm', 'Hm', 'Hmm…', 'Hmm?', 'Ha!', 'Hah!', 'Hahaha', 'Ha ha ha!']) {
      expect(isPhoneticVocalizationLine(line)).toBe(true);
    }
  });

  it('keeps speakable interjections and real dialogue', () => {
    for (const line of [
      'Hey.',
      'Hi!',
      'Yes.',
      'Oh!',
      'Ah!',
      'Wait!',
      'Goodneighbor!',
      'Knight?',
      'Grrrah! Let go!',
      'Grrargh! Let go!',
      'Гра!',
      'Hmph. Good riddance.',
    ]) {
      expect(isPhoneticVocalizationLine(line)).toBe(false);
    }
  });

  it('does not treat empty as a vocalization', () => {
    expect(isPhoneticVocalizationLine('')).toBe(false);
    expect(isPhoneticVocalizationLine('   ')).toBe(false);
  });

  it('matches punctuation-only lines', () => {
    expect(isPhoneticVocalizationLine('...')).toBe(true);
  });
});

describe('isWordlessSpokenLine', () => {
  it('matches sounds written without a vowel, however they are spelled', () => {
    for (const line of [
      'Гх!',
      'Ггх!',
      'Гх...',
      'Хр-рх!',
      'Гм.',
      'М-м-м...',
      'Ммм-гм.',
      "Г'гх!",
      'Нннгх!',
      'ГГГХХХ!!',
      'Тсс...',
      '"Мгм."',
      'Zzz... zzzzz...',
      'Гх... Нх...',
    ]) {
      expect(isWordlessSpokenLine(line)).toBe(true);
    }
  });

  it('matches a line that mixes them with the known grunts', () => {
    expect(isWordlessSpokenLine('Бррх... ох...')).toBe(true);
    expect(isWordlessSpokenLine('Агх!')).toBe(true);
  });

  it('keeps words, one-letter words and initialisms', () => {
    for (const line of [
      'Угу.',
      'Ой!',
      'Гм, цікаво.',
      'В...',
      'Г. Д. Б.',
      'РГМ?',
      'CPD...',
      'НГХ!!',
      '5 км.',
      'Pöttöm.',
    ]) {
      expect(isWordlessSpokenLine(line)).toBe(false);
    }
  });

  it('does not treat empty as wordless', () => {
    expect(isWordlessSpokenLine('')).toBe(false);
  });
});
