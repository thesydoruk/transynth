import {
  canSynthesizeVoiceLine,
  isFullNonSpeechMarkerLine,
  isInterjectStubEdid,
  prepareVoiceTtsText,
  stripVoiceNonSpeechBlocks,
} from '../prepareVoiceTtsText';

describe('stripVoiceNonSpeechBlocks', () => {
  it('removes prefix, suffix, and mid blocks', () => {
    expect(stripVoiceNonSpeechBlocks('*chuckle* Hello there')).toBe('Hello there');

    expect(stripVoiceNonSpeechBlocks('Yeah... *groan*')).toBe('Yeah...');

    expect(stripVoiceNonSpeechBlocks('Hey *chuckle*')).toBe('Hey');
  });

  it('strips multiple blocks in one line', () => {
    expect(stripVoiceNonSpeechBlocks('*Gasping* *Coughing*')).toBe('');

    expect(stripVoiceNonSpeechBlocks('*ahem* Now, was there anything?')).toBe(
      'Now, was there anything?',
    );
  });

  it('strips bracketed tone tags and UI tokens', () => {
    expect(stripVoiceNonSpeechBlocks('[Сарказм] Ну звісно, це геніальний план.')).toBe(
      'Ну звісно, це геніальний план.',
    );

    expect(stripVoiceNonSpeechBlocks('Натисни [Activate], щоб увійти.')).toBe(
      'Натисни , щоб увійти.',
    );

    expect(stripVoiceNonSpeechBlocks('[Сарказм]')).toBe('');
  });
});

describe('isFullNonSpeechMarkerLine', () => {
  it('matches full asterisk and paren lines', () => {
    expect(isFullNonSpeechMarkerLine('*Sigh*')).toBe(true);

    expect(isFullNonSpeechMarkerLine('(Whine)')).toBe(true);
  });

  it('matches a line that is only a bracketed tag', () => {
    expect(isFullNonSpeechMarkerLine('[Сарказм]')).toBe(true);

    expect(isFullNonSpeechMarkerLine('[Brotherhood of Steel]')).toBe(true);

    expect(isFullNonSpeechMarkerLine('[Сарказм] Ну звісно.')).toBe(false);
  });

  it('does not match dialogue with markers', () => {
    expect(isFullNonSpeechMarkerLine('*chuckle* Hello')).toBe(false);

    expect(isFullNonSpeechMarkerLine('Listen, Nick.')).toBe(false);
  });
});

describe('isInterjectStubEdid', () => {
  it('detects companion interject stub EDIDs', () => {
    expect(isInterjectStubEdid('CA_Interject_Stub_Cait')).toBe(true);

    expect(isInterjectStubEdid('CA_Interject_Stub_Codsworth')).toBe(true);
  });

  it('ignores other EDIDs and dialogue source text', () => {
    expect(isInterjectStubEdid(null)).toBe(false);

    expect(isInterjectStubEdid('SomeOtherRecord')).toBe(false);
  });
});

describe('prepareVoiceTtsText', () => {
  it('skips animal sound lines', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: '(Whine)',

        translation: '*скавчить*',

        speakerSource: '(Whine)',
      }),
    ).toEqual({ action: 'skip', reason: 'non_speech_marker' });
  });

  it('skips interject stubs by EDID', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Cait interjects',

        translation: '*Кейт втручається у розмову*',

        speakerSource: 'Cait interjects',

        edid: 'CA_Interject_Stub_Cait',
      }),
    ).toEqual({ action: 'skip', reason: 'interject_stub' });
  });

  it('does not skip interject-looking source without stub EDID', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Cait interjects',

        translation: '*Кейт втручається у розмову*',

        speakerSource: 'Cait interjects',
      }),
    ).toEqual({ action: 'skip', reason: 'non_speech_marker' });
  });

  it('cleans both translation and speaker source', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: '*chuckle* This troublemaker here used to be a real headache.',

        translation: '*смішок* Цей негідник колись завдавав нам справжнього клопоту.',

        speakerSource: '*chuckle* This troublemaker here used to be a real headache.',
      }),
    ).toEqual({
      action: 'synthesize',

      text: 'Цей негідник колись завдавав нам справжнього клопоту.',

      speakerText: 'This troublemaker here used to be a real headache.',
    });
  });

  it('skips lines that are only a tone tag', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Sarcastic',

        translation: '[Сарказм]',

        speakerSource: 'Sarcastic',
      }),
    ).toEqual({ action: 'skip', reason: 'non_speech_marker' });
  });

  it('strips a leading tone tag from dialogue', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Sarcastic. Oh, what a shame. Pity it came to this.',

        translation: '[Сарказм] Який розпач. Шкода, що все до цього дійшло.',

        speakerSource: 'Oh, what a shame. Pity it came to this.',
      }),
    ).toEqual({
      action: 'synthesize',

      text: 'Який розпач. Шкода, що все до цього дійшло.',

      speakerText: 'Oh, what a shame. Pity it came to this.',
    });
  });

  it('skips phonetic combat grunts', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Oof!',
        translation: 'Уф!',
        speakerSource: 'Oof!',
      }),
    ).toEqual({ action: 'skip', reason: 'phonetic_vocalization' });
  });

  it('skips when stripping leaves no speakable translation', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: '*Gasping* *Coughing*',

        translation: '*хапає ротом повітря* *кашляє*',

        speakerSource: '*Gasping* *Coughing*',
      }),
    ).toEqual({ action: 'skip', reason: 'empty_after_strip' });
  });

  it('cleans speaker source independently in speaker-reference mode', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: 'Now, was there anything particular you came to our city for?',

        translation: 'То ви прийшли до нашого міста з якоюсь конкретною метою?',

        speakerSource: '*ahem* Now, was there anything particular you came to our city for?',
      }),
    ).toEqual({
      action: 'synthesize',

      text: 'То ви прийшли до нашого міста з якоюсь конкретною метою?',

      speakerText: 'Now, was there anything particular you came to our city for?',
    });
  });
});

describe('canSynthesizeVoiceLine', () => {
  it('returns false for non-speech and true for dialogue', () => {
    expect(canSynthesizeVoiceLine('(Growl)', '(ричить)')).toBe(false);

    expect(canSynthesizeVoiceLine('*ahem* Hello?', 'Привіт?')).toBe(true);

    expect(
      canSynthesizeVoiceLine(
        'Cait interjects',

        '*Кейт втручається у розмову*',

        'CA_Interject_Stub_Cait',
      ),
    ).toBe(false);
  });

  it('skips phonetic vocalizations, fillers, and laughs', () => {
    expect(canSynthesizeVoiceLine('Agh!', 'Агх!')).toBe(false);
    expect(canSynthesizeVoiceLine('Hmm...', 'Хм...')).toBe(false);
    expect(canSynthesizeVoiceLine('Ha!', 'Ха!')).toBe(false);
    expect(canSynthesizeVoiceLine('Hey.', 'Гей.')).toBe(true);
  });
});

describe('Disco italic markup', () => {
  it('keeps emphasized words and drops only the asterisks', () => {
    expect(stripVoiceNonSpeechBlocks('Це просто *такі фрази*, нічого більше.', 'disco')).toBe(
      'Це просто такі фрази, нічого більше.',
    );
    expect(stripVoiceNonSpeechBlocks('*такі фрази*', 'disco')).toBe('такі фрази');
  });

  it('still strips bracket tags', () => {
    expect(stripVoiceNonSpeechBlocks('[Click] Look at *this*.', 'disco')).toBe('Look at this.');
  });

  it('synthesizes a line that is only italic emphasis', () => {
    expect(canSynthesizeVoiceLine('*Such a waste.*', '*Така втрата.*', null, 'disco')).toBe(true);
    expect(
      prepareVoiceTtsText({
        lineSource: '*Such a waste.*',
        translation: '*Така втрата.*',
        speakerSource: '*Such a waste.*',
        markup: 'disco',
      }),
    ).toEqual({
      action: 'synthesize',
      text: 'Така втрата.',
      speakerText: 'Such a waste.',
    });
  });

  it('does not skip Fallout-style *chuckle* prefixes — the words stay in the line', () => {
    expect(
      prepareVoiceTtsText({
        lineSource: '*chuckle* This troublemaker here.',
        translation: '*смішок* Цей негідник.',
        speakerSource: '*chuckle* This troublemaker here.',
        markup: 'disco',
      }),
    ).toEqual({
      action: 'synthesize',
      text: 'смішок Цей негідник.',
      speakerText: 'chuckle This troublemaker here.',
    });
  });
});
