import { resolveSpeakerReferenceEnabled, resolveTtsReferenceMode } from '../voiceToolPaths';

describe('resolveTtsReferenceMode', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ['TTS_LINE_REFERENCE', 'TTS_SPEAKER_REFERENCE']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ['TTS_LINE_REFERENCE', 'TTS_SPEAKER_REFERENCE']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('defaults to speaker reference', () => {
    expect(resolveTtsReferenceMode()).toBe('speaker');
    expect(resolveSpeakerReferenceEnabled()).toBe(true);
  });

  it('uses line reference when TTS_LINE_REFERENCE=1', () => {
    process.env.TTS_LINE_REFERENCE = '1';
    expect(resolveTtsReferenceMode()).toBe('line');
    expect(resolveSpeakerReferenceEnabled()).toBe(false);
  });

  it('uses line reference when TTS_SPEAKER_REFERENCE=0', () => {
    process.env.TTS_SPEAKER_REFERENCE = '0';
    expect(resolveTtsReferenceMode()).toBe('line');
  });

  it('prefers TTS_LINE_REFERENCE over TTS_SPEAKER_REFERENCE', () => {
    process.env.TTS_LINE_REFERENCE = '1';
    process.env.TTS_SPEAKER_REFERENCE = '1';
    expect(resolveTtsReferenceMode()).toBe('line');
  });
});
