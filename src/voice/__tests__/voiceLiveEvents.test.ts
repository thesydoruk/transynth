import { parseVoiceLiveEvent, voiceLiveLineKey } from '../voiceLiveEvents';

describe('parseVoiceLiveEvent', () => {
  const valid = {
    type: 'line_done',
    modId: 4,
    speakerKey: 'PlayerVoiceMale01',
    formidLower6: '005825',
    variant: 1,
    voiceSimilarity: 0.82,
  };

  it('accepts a complete line event', () => {
    expect(parseVoiceLiveEvent(valid)).toEqual(valid);
  });

  it('drops malformed payloads', () => {
    expect(parseVoiceLiveEvent(null)).toBeNull();
    expect(parseVoiceLiveEvent({ ...valid, type: 'progress' })).toBeNull();
    expect(parseVoiceLiveEvent({ ...valid, modId: 0 })).toBeNull();
    expect(parseVoiceLiveEvent({ ...valid, speakerKey: '' })).toBeNull();
    expect(parseVoiceLiveEvent({ ...valid, variant: 0 })).toBeNull();
  });

  it('keeps voiceSimilarity only on successful writes', () => {
    expect(
      parseVoiceLiveEvent({ ...valid, type: 'line_started' })?.voiceSimilarity,
    ).toBeUndefined();
    expect(parseVoiceLiveEvent({ ...valid, voiceSimilarity: 'bad' })?.voiceSimilarity).toBeNull();
  });
});

describe('voiceLiveLineKey', () => {
  it('joins speaker, formid and variant', () => {
    expect(voiceLiveLineKey({ speakerKey: 'Nora', formidLower6: '005825', variant: 2 })).toBe(
      'Nora:005825:2',
    );
  });
});
