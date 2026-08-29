import {
  _setWavDurationCacheForTests,
  decideDiscoSpokenText,
  extractDiscoQuotedSpeech,
  hasDiscoNarrationOutsideQuotes,
  resolveDiscoSpokenRowText,
} from '../discoSpokenText';

describe('extractDiscoQuotedSpeech', () => {
  it('returns null for quote-free narration', () => {
    expect(extractDiscoQuotedSpeech('Your key no longer turns in the lock.')).toBeNull();
  });

  it('extracts ASCII double-quoted speech', () => {
    expect(extractDiscoQuotedSpeech('She gathers herself for a moment, then says, "Okay."')).toBe(
      'Okay.',
    );
  });

  it('joins multiple quoted segments in order', () => {
    expect(extractDiscoQuotedSpeech('"Foo," he says, "bar."')).toBe('Foo, bar.');
  });

  it('supports typographic and guillemet quotes (translations)', () => {
    expect(extractDiscoQuotedSpeech('Вона каже: «Гаразд».')).toBe('Гаразд');
    expect(extractDiscoQuotedSpeech('He mumbles: “What...?”')).toBe('What...?');
  });
});

describe('hasDiscoNarrationOutsideQuotes', () => {
  it('is false when the whole line is one quote', () => {
    expect(hasDiscoNarrationOutsideQuotes('"Nah, I\'ll get by somehow."')).toBe(false);
  });

  it('is false without quotes', () => {
    expect(hasDiscoNarrationOutsideQuotes('Punch the door.')).toBe(false);
  });

  it('is true for narration followed by speech', () => {
    expect(hasDiscoNarrationOutsideQuotes('He nods. "Yes, we both need rest."')).toBe(true);
  });

  it('ignores bare punctuation outside quotes', () => {
    expect(hasDiscoNarrationOutsideQuotes('"Foo," -- "bar."')).toBe(false);
  });
});

describe('decideDiscoSpokenText', () => {
  // Real measured pack data: Acele-ICE  ACELE-690.wav is 0.87 s for this line.
  it('keeps only the quote when the clip is short (character take)', () => {
    expect(
      decideDiscoSpokenText('She gathers herself for a moment, then says, "Okay."', 0.87),
    ).toBe('Okay.');
  });

  // Real measured pack data: A Folded Library Card-...-2.wav is 13.76 s.
  it('keeps the full line when the clip covers it (narrator take)', () => {
    const line =
      'The library card is folded into two and still slightly wet to the touch. ' +
      'The front side reads: "Central Jamrock Public Library Card. Issued to ' +
      'Billie Méjean, expires July \'53."';
    expect(decideDiscoSpokenText(line, 13.76)).toBe(line);
  });

  it('keeps mixed text unchanged when duration is unknown', () => {
    const line = 'He nods. "Yes."';
    expect(decideDiscoSpokenText(line, 0)).toBe(line);
  });

  it('keeps quote-free lines unchanged regardless of duration', () => {
    expect(decideDiscoSpokenText('Punch the door.', 0.5)).toBe('Punch the door.');
  });
});

describe('resolveDiscoSpokenRowText', () => {
  it('reduces source and translation to quoted speech for character clips', () => {
    _setWavDurationCacheForTests('/fake/short.wav', 0.9);
    expect(
      resolveDiscoSpokenRowText(
        {
          source: 'She gathers herself for a moment, then says, "Okay."',
          translation: 'Вона збирається з думками, а тоді каже: «Гаразд».',
        },
        '/fake/short.wav',
      ),
    ).toEqual({ source: 'Okay.', translation: 'Гаразд' });
  });

  it('keeps the full translation when it has no recognizable quotes', () => {
    _setWavDurationCacheForTests('/fake/short2.wav', 0.9);
    expect(
      resolveDiscoSpokenRowText(
        {
          source: 'She gathers herself for a moment, then says, "Okay."',
          translation: 'Гаразд, хай так.',
        },
        '/fake/short2.wav',
      ),
    ).toEqual({ source: 'Okay.', translation: 'Гаразд, хай так.' });
  });

  it('returns rows unchanged for fully quoted lines without touching the wav', () => {
    const row = {
      source: '"Right, I should go pay my debts."',
      translation: '«Так, спершу треба сплатити борги».',
    };
    expect(resolveDiscoSpokenRowText(row, '/fake/never-read.wav')).toEqual(row);
  });

  it('returns rows unchanged for narrator clips', () => {
    _setWavDurationCacheForTests('/fake/long.wav', 13.76);
    const row = {
      source:
        'The library card is folded into two and still slightly wet to the touch. ' +
        'The front side reads: "Central Jamrock Public Library Card."',
      translation: 'Читацький квиток складено навпіл. На лицьовому боці: «Бібліотека Джемрока».',
    };
    expect(resolveDiscoSpokenRowText(row, '/fake/long.wav')).toEqual(row);
  });
});
