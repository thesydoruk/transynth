import { isUsableTranscript } from '../import/transcriptQuality';

describe('isUsableTranscript', () => {
  it('rejects dash placeholders and tiny strings', () => {
    expect(isUsableTranscript('-')).toBe(false);
    expect(isUsableTranscript('—')).toBe(false);
    expect(isUsableTranscript('hi')).toBe(false);
  });

  it('accepts real Ukrainian sentences', () => {
    expect(isUsableTranscript('Коріння вчення гірке, та плоди його солодкі.')).toBe(true);
  });
});
