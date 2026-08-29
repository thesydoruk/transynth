import { isPhoneticVocalizationLine } from '../phoneticVocalization';

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
