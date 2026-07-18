import {
  voiceTranslationMapKey,
  lookupVoiceTranslation,
  normalizeVoiceText,
} from '../loadVoiceTranslations';

describe('normalizeVoiceText', () => {
  it('treats whitespace-only strings as missing', () => {
    expect(normalizeVoiceText(' ')).toBeNull();
    expect(normalizeVoiceText('  \n ')).toBeNull();
  });

  it('returns trimmed non-empty text', () => {
    expect(normalizeVoiceText(' hello ')).toBe('hello');
  });
});

describe('voiceTranslationMapKey', () => {
  it('combines lower-6 formid and 1-based voice variant', () => {
    expect(voiceTranslationMapKey('002cba', 4)).toBe('002CBA:4');
    expect(voiceTranslationMapKey('01EFF', 1)).toBe('01EFF:1');
  });
});

describe('lookupVoiceTranslation', () => {
  const rows = new Map([
    [
      '002CBA:1',
      {
        formidLower6: '002CBA',
        infoFormidHex: '00002CBA',
        voiceVariant: 1,
        translation: 'Привіт',
        source: 'Hello',
        edid: null,
      },
    ],
  ]);

  it('returns exact variant match', () => {
    expect(lookupVoiceTranslation(rows, '002cba', 1)?.translation).toBe('Привіт');
  });

  it('falls back to closest variant for the same formid', () => {
    expect(lookupVoiceTranslation(rows, '002CBA', 4)?.translation).toBe('Привіт');
  });
});
