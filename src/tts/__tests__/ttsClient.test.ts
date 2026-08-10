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

  it('includes default sampling hyperparameters', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'));

    expect(form.get('temperature')).toBe('0.65');
    expect(form.get('repetition_penalty')).toBe('1.2');
    expect(form.get('top_p')).toBe('0.8');
  });

  it('applies synthesis overrides', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      synthesis: { temperature: 0.5, repetitionPenalty: 2, topP: 0.9 },
    });

    expect(form.get('temperature')).toBe('0.5');
    expect(form.get('repetition_penalty')).toBe('2');
    expect(form.get('top_p')).toBe('0.9');
  });
});
