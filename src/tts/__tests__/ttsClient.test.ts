import { buildSynthesisForm } from '../ttsClient';

describe('buildSynthesisForm', () => {
  it('includes speaker_text when a single reference transcript is provided', () => {
    const form = buildSynthesisForm('Привіт.', [Buffer.from('RIFF')], {
      language: 'uk',
      speakerText: 'Hello there.',
    });

    expect(form.get('text')).toBe('Привіт.');
    expect(form.get('language')).toBe('uk');
    expect(form.get('speaker_text')).toBe('Hello there.');
    expect(form.get('backend')).toBe('fish-speech');
    expect(form.get('speaker_wav')).toBeInstanceOf(Blob);
    expect(form.getAll('speaker_texts')).toEqual([]);
  });

  it('omits speaker_text when reference transcript is empty', () => {
    const form = buildSynthesisForm('Привіт.', [Buffer.from('RIFF')], {
      speakerText: '   ',
    });

    expect(form.get('speaker_text')).toBeNull();
    expect(form.get('backend')).toBe('fish-speech');
  });

  it('sends multiple speaker_wav and speaker_texts', () => {
    const form = buildSynthesisForm('Привіт.', [Buffer.from('RIFF1'), Buffer.from('RIFF2')], {
      speakerTexts: ['UK transcript.', 'English line.'],
    });

    expect(form.getAll('speaker_wav')).toHaveLength(2);
    expect(form.getAll('speaker_texts')).toEqual(['UK transcript.', 'English line.']);
    expect(form.get('speaker_text')).toBeNull();
  });
});
