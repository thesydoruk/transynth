import { voiceTranslationMapKey } from '../loadVoiceTranslations';

describe('voiceTranslationMapKey', () => {
  it('combines lower-6 formid and 1-based voice variant', () => {
    expect(voiceTranslationMapKey('002cba', 4)).toBe('002CBA:4');
    expect(voiceTranslationMapKey('01EFF', 1)).toBe('01EFF:1');
  });
});
