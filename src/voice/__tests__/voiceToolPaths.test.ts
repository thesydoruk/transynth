import { resolveTtsLanguage } from '../voiceToolPaths';

describe('resolveTtsLanguage', () => {
  it('maps target locale to TTS language code', () => {
    expect(resolveTtsLanguage('uk')).toBe('uk');
    expect(resolveTtsLanguage('UA')).toBe('uk');
    expect(resolveTtsLanguage('de')).toBe('de');
  });

  it('rejects empty target locale', () => {
    expect(() => resolveTtsLanguage('  ')).toThrow('Target language is required for TTS');
  });
});
