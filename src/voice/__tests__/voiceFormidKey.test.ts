import { describe, expect, it } from '@jest/globals';
import { isVoiceFormidKey } from '../voiceFormidKey';

describe('isVoiceFormidKey', () => {
  it('accepts Bethesda lower-6 and Disco 12-hex stem ids', () => {
    expect(isVoiceFormidKey('002CBA')).toBe(true);
    expect(isVoiceFormidKey('002cba')).toBe(true);
    expect(isVoiceFormidKey('A1B2C3D4E5F6')).toBe(true);
  });

  it('rejects empty, odd-length, and non-hex values', () => {
    expect(isVoiceFormidKey('')).toBe(false);
    expect(isVoiceFormidKey('002CB')).toBe(false);
    expect(isVoiceFormidKey('002CBAA')).toBe(false);
    expect(isVoiceFormidKey('002CBG')).toBe(false);
  });
});
