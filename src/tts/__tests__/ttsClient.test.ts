import { buildSynthesisForm, readSynthWarning, TTS_SYNTH_WARNING_HEADER } from '../ttsClient';

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

  it('includes default match flags', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'));

    expect(form.get('match_loudness')).toBe('true');
    expect(form.get('match_timing')).toBe('true');
    expect(form.get('temperature')).toBeNull();
    expect(form.get('repetition_penalty')).toBeNull();
    expect(form.get('top_p')).toBeNull();
  });

  it('appends several speaker clips in order', () => {
    const form = buildSynthesisForm('Привіт.', [
      { wav: Buffer.from('RIFF-a'), speakerText: 'Short line.' },
      { wav: Buffer.from('RIFF-b'), speakerText: 'Speaker default.' },
    ]);

    const wavs = form.getAll('speaker_wav');
    expect(wavs).toHaveLength(2);
    expect(form.get('speaker_text')).toBeNull();
    expect(form.getAll('speaker_texts')).toEqual(['Short line.', 'Speaker default.']);
  });

  it('fills missing speaker_texts so multi-ref requests stay paired', () => {
    const form = buildSynthesisForm('Привіт.', [
      { wav: Buffer.from('RIFF-a'), speakerText: 'Short line.' },
      { wav: Buffer.from('RIFF-b') },
      { wav: Buffer.from('RIFF-c'), speakerText: '   ' },
    ]);

    expect(form.getAll('speaker_wav')).toHaveLength(3);
    expect(form.getAll('speaker_texts')).toEqual(['Short line.', 'Short line.', 'Short line.']);
  });

  it('uses the line text when every extra clip is missing a transcript', () => {
    const form = buildSynthesisForm('Привіт.', [
      { wav: Buffer.from('RIFF-a') },
      { wav: Buffer.from('RIFF-b') },
    ]);

    expect(form.getAll('speaker_texts')).toEqual(['Привіт.', 'Привіт.']);
  });

  it('applies synthesis overrides', () => {
    const form = buildSynthesisForm('Привіт.', Buffer.from('RIFF'), {
      synthesis: {
        matchLoudness: false,
        matchTiming: false,
      },
    });

    expect(form.get('match_loudness')).toBe('false');
    expect(form.get('match_timing')).toBe('false');
  });
});

describe('readSynthWarning', () => {
  it('reads the Fish Speech warning header', () => {
    const headers = new Headers({
      [TTS_SYNTH_WARNING_HEADER]: 'silence after 3 attempts (0.00s active speech)',
    });
    expect(readSynthWarning(headers)).toBe('silence after 3 attempts (0.00s active speech)');
  });

  it('is empty when the take is clean', () => {
    expect(readSynthWarning(new Headers())).toBe('');
  });
});
