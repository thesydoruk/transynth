import { cvSpeakerVoiceId, parseCvGender } from '../import/clientId';

describe('cvSpeakerVoiceId', () => {
  it('is stable and prefixed', () => {
    const a = cvSpeakerVoiceId('abc');
    const b = cvSpeakerVoiceId('abc');
    expect(a).toBe(b);
    expect(a.startsWith('cv:')).toBe(true);
    expect(a.length).toBe(3 + 16);
  });
});

describe('parseCvGender', () => {
  it('maps CV demographic labels', () => {
    expect(parseCvGender('male_masculine')).toBe('male');
    expect(parseCvGender('female_feminine')).toBe('female');
    expect(parseCvGender('')).toBe('unknown');
  });
});
