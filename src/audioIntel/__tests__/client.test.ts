import { describe, expect, it } from '@jest/globals';
import { parseAudioIntelTranscript } from '../client';

describe('parseAudioIntelTranscript', () => {
  it('keeps speech segments and joins text', () => {
    const parsed = parseAudioIntelTranscript({
      text: 'Someone has scribbled.',
      confidence: 0.91,
      duration: 2.4,
      language: 'en',
      segments: [
        { kind: 'speech', start: 0, end: 1.1, text: 'Someone has scribbled.', confidence: 0.9 },
        { kind: 'sound', start: 1.1, end: 1.3, label: 'Silence', score: 0.4 },
      ],
    });
    expect(parsed).toEqual({
      text: 'Someone has scribbled.',
      confidence: 0.91,
      duration: 2.4,
      language: 'en',
      segments: [{ start: 0, end: 1.1, text: 'Someone has scribbled.', confidence: 0.9 }],
    });
  });

  it('falls back to joined speech when top-level text is empty', () => {
    const parsed = parseAudioIntelTranscript({
      text: '  ',
      segments: [{ kind: 'speech', start: 0, end: 0.8, text: 'Okay.' }],
    });
    expect(parsed.text).toBe('Okay.');
    expect(parsed.segments[0]?.confidence).toBeNull();
  });
});
