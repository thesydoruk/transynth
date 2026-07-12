import { buildXttsSynthesisForm } from '../xttsClient';

describe('buildXttsSynthesisForm', () => {
  it('includes speaker_text when reference transcript is provided', () => {
    const form = buildXttsSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      language: 'uk',
      speakerText: 'Hello there.',
    });

    expect(form.get('text')).toBe('Привіт.');
    expect(form.get('language')).toBe('uk');
    expect(form.get('speaker_text')).toBe('Hello there.');
    expect(form.get('speaker_wav')).toBeInstanceOf(Blob);
  });

  it('omits speaker_text when reference transcript is empty', () => {
    const form = buildXttsSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      speakerText: '   ',
    });

    expect(form.get('speaker_text')).toBeNull();
  });

  it('includes backend when specified', () => {
    const form = buildXttsSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      backend: 'fish-speech',
    });

    expect(form.get('backend')).toBe('fish-speech');
  });

  it('omits backend when not specified', () => {
    const form = buildXttsSynthesisForm('Привіт.', Buffer.from('RIFF'));

    expect(form.get('backend')).toBeNull();
  });
});
