import { describe, expect, it } from '@jest/globals';
import { isVoiceFormidKey } from '../voiceFormidKey';

describe('isVoiceFormidKey', () => {
  it('accepts every game’s line ids', () => {
    expect(isVoiceFormidKey('002CBA')).toBe(true);
    expect(isVoiceFormidKey('002cba')).toBe(true);
    expect(isVoiceFormidKey('A1B2C3D4E5F6')).toBe(true);
    expect(isVoiceFormidKey('1185686')).toBe(true);
  });

  it('rejects empty, overlong, and anything a path could be bent with', () => {
    expect(isVoiceFormidKey('')).toBe(false);
    expect(isVoiceFormidKey('1'.repeat(33))).toBe(false);
    expect(isVoiceFormidKey('../etc')).toBe(false);
    expect(isVoiceFormidKey('002CB A')).toBe(false);
    expect(isVoiceFormidKey('1185686:1')).toBe(false);
  });
});
