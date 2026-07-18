import {
  canSynthesizeVoiceLine,
  isFullNonSpeechMarkerLine,
  isInterjectStubEdid,
  prepareVoiceTtsText,
  stripVoiceAsteriskBlocks,
} from '../prepareVoiceTtsText';

describe('stripVoiceAsteriskBlocks', () => {
  it('removes prefix, suffix, and mid blocks', () => {
    expect(stripVoiceAsteriskBlocks('*chuckle* Hello there')).toBe('Hello there');

    expect(stripVoiceAsteriskBlocks('Yeah... *groan*')).toBe('Yeah...');

    expect(stripVoiceAsteriskBlocks('Hey *chuckle*')).toBe('Hey');
  });

  it('strips multiple blocks in one line', () => {
    expect(stripVoiceAsteriskBlocks('*Gasping* *Coughing*')).toBe('');

    expect(stripVoiceAsteriskBlocks('*ahem* Now, was there anything?')).toBe(
      'Now, was there anything?',
    );
  });
});

describe('isFullNonSpeechMarkerLine', () => {
  it('matches full asterisk and paren lines', () => {
    expect(isFullNonSpeechMarkerLine('*Sigh*')).toBe(true);

    expect(isFullNonSpeechMarkerLine('(Whine)')).toBe(true);
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
});
