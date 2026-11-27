import { prepareVoiceTtsText } from '../prepareVoiceTtsText';
import { matchReusableVoiceLines } from '../reuseSynthesizedVoiceMatch';
import {
  computeVoiceTtsPayloadVersion,
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
  voiceTtsRequestText,
} from '../voiceTtsPayloadVersion';

describe('computeVoiceTtsPayloadVersion', () => {
  it('hashes text, speaker_text, language, and audio post version', () => {
    const a = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerText: 'Hello.',
      language: 'uk',
    });
    const b = computeVoiceTtsPayloadVersion({
      text: 'Привіт.',
      speakerText: 'Hello.',
      language: 'uk',
    });
    const c = computeVoiceTtsPayloadVersion({
      text: 'Інший текст.',
      speakerText: 'Hello.',
      language: 'uk',
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
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

describe('effort tags', () => {
  const speech = { action: 'synthesize', text: 'Лягай!', speakerText: 'Get down!' } as const;

  it('puts the tag in front of the text sent to TTS and leaves the spoken text alone', () => {
    const tagged = { ...speech, effortTag: 'shouting' } as const;
    expect(voiceTtsRequestText(tagged)).toBe('[shouting] Лягай!');
    expect(tagged.text).toBe('Лягай!');
    expect(voiceTtsRequestText(speech)).toBe('Лягай!');
  });

  it('stamps a tagged line differently, and an untagged one as it always was', () => {
    const untagged = voiceTtsPayloadVersionFromPrepared(speech, 'uk');
    expect(untagged).toBe(
      computeVoiceTtsPayloadVersion({ text: 'Лягай!', speakerText: 'Get down!', language: 'uk' }),
    );
    const shouting = voiceTtsPayloadVersionFromPrepared({ ...speech, effortTag: 'shouting' }, 'uk');
    const loud = voiceTtsPayloadVersionFromPrepared({ ...speech, effortTag: 'loud' }, 'uk');
    expect(new Set([untagged, shouting, loud]).size).toBe(3);
  });

  it('carries the tag through text preparation without touching the words', () => {
    const prepared = prepareVoiceTtsText({
      lineSource: '*gasp* Get down!',
      translation: '*зойк* Лягай!',
      speakerSource: '*gasp* Get down!',
      effortTag: 'shouting',
    });
    expect(prepared).toEqual({
      action: 'synthesize',
      text: 'Лягай!',
      speakerText: 'Get down!',
      effortTag: 'shouting',
    });
    expect(
      prepareVoiceTtsText({
        lineSource: 'Get down!',
        translation: 'Лягай!',
        speakerSource: 'Get down!',
        effortTag: null,
      }),
    ).toEqual({ action: 'synthesize', text: 'Лягай!', speakerText: 'Get down!' });
  });

  it('does not pair a line with a donor take made under another tag', () => {
    const line = {
      speakerKey: 'RaiderMale01',
      originPlugin: 'fallout4.esm',
      sourceText: 'Get down!',
      translation: 'Лягай!',
      sourceAbsPath: '',
      sourceRelPath: '',
      lineKey: '021B2A',
      variant: 1,
    };
    const dest = { ...line, destRelPath: 'a.fuz', hasLocalized: false, effortTag: 'shouting' };
    const donor = { ...line, localizedAbsPath: 'b.fuz', ttsTextVersion: 'v', voiceSimilarity: 0.4 };

    expect(matchReusableVoiceLines([dest as never], [donor])).toHaveLength(0);
    expect(
      matchReusableVoiceLines([dest as never], [{ ...donor, effortTag: 'shouting' }]),
    ).toHaveLength(1);
  });
});

describe('isVoiceSynthesisCurrent', () => {
  it('requires matching version and existing file', () => {
    expect(isVoiceSynthesisCurrent('abc', 'abc', true)).toBe(true);
    expect(isVoiceSynthesisCurrent('abc', 'def', true)).toBe(false);
    expect(isVoiceSynthesisCurrent('abc', 'abc', false)).toBe(false);
  });
});
