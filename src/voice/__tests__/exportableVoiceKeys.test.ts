import { describe, expect, it } from '@jest/globals';
import { voiceKeyFromLocalizedFileName } from '../exportableVoiceKeys';
import { canSynthesizeVoiceLine } from '../prepareVoiceTtsText';

describe('voiceKeyFromLocalizedFileName', () => {
  it('parses Bethesda FormID_variant clips', () => {
    expect(voiceKeyFromLocalizedFileName('00123456_1.fuz')).toBe('123456:1');
    expect(voiceKeyFromLocalizedFileName('000219CF_2.wav')).toBe('0219CF:2');
  });

  it('rejects leftover names that are not voice takes', () => {
    expect(voiceKeyFromLocalizedFileName('extra.fuz')).toBeNull();
    expect(voiceKeyFromLocalizedFileName('readme.txt')).toBeNull();
  });
});

describe('export allowlist uses the same TTS skip rules', () => {
  it('allows speakable translated lines and rejects vocalizations', () => {
    expect(canSynthesizeVoiceLine('Hello, traveler.', 'Привіт, мандрівнику.')).toBe(true);
    expect(canSynthesizeVoiceLine('Oof!', 'Оф!')).toBe(false);
    expect(canSynthesizeVoiceLine('Grrargh!', 'Грраргх!')).toBe(false);
    expect(canSynthesizeVoiceLine('Nnh!', 'Ннх!')).toBe(false);
  });
});
