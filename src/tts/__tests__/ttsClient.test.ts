import { buildSynthesisForm } from '../ttsClient';

describe('buildSynthesisForm', () => {
  it('includes speaker_text when reference transcript is provided', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      language: 'uk',
      speakerText: 'Hello there.',
    });

    expect(form.get('text')).toBe('Привіт.');
    expect(form.get('language')).toBe('uk');
    expect(form.get('speaker_text')).toBe('Hello there.');
    expect(form.get('backend')).toBe('fish-speech');
    expect(form.get('speaker_wav')).toBeInstanceOf(Blob);
  });

  it('omits speaker_text when reference transcript is empty', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      speakerText: '   ',
    });

    expect(form.get('speaker_text')).toBeNull();
    expect(form.get('backend')).toBe('fish-speech');
  });
});
