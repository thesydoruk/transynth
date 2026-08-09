import { computeVoiceTtsPayloadVersion, isVoiceSynthesisCurrent } from '../voiceTtsPayloadVersion';

describe('computeVoiceTtsPayloadVersion', () => {
  it('hashes text, speakerTexts, language, and audio post version', () => {
    const a = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerText: 'Hello.',
      language: 'uk',
    });
    const b = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerTexts: ['Hello.'],
      language: 'uk',
    });
    const c = computeVoiceTtsPayloadVersion({
      text: 'Інший текст.',
      speakerText: 'Hello.',
      language: 'uk',
    });
    const multi = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerTexts: ['UK.', 'Hello.'],
      language: 'uk',
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(multi);
  });

  it('treats missing speaker_text as empty', () => {
    const withEmpty = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerText: '',
      language: 'uk',
    });
    const omitted = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      language: 'uk',
    });
    expect(withEmpty).toBe(omitted);
  });
});

describe('isVoiceSynthesisCurrent', () => {
  it('requires matching version and existing file', () => {
    expect(isVoiceSynthesisCurrent('abc', 'abc', true)).toBe(true);
    expect(isVoiceSynthesisCurrent('abc', 'def', true)).toBe(false);
    expect(isVoiceSynthesisCurrent('abc', 'abc', false)).toBe(false);
  });
});
