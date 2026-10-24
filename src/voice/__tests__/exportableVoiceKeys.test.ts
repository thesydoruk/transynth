import { describe, expect, it } from '@jest/globals';
import { voiceKeyFromLocalizedRelPath } from '../exportableVoiceKeys';
import { canSynthesizeVoiceLine } from '../prepareVoiceTtsText';

describe('voiceKeyFromLocalizedRelPath', () => {
  it('qualifies the key with the origin folder of the take', () => {
    expect(
      voiceKeyFromLocalizedRelPath('Sound/Voice/Fallout4.esm/MaleRough/00123456_1.fuz', 'fo4'),
    ).toBe('fallout4.esm/123456:1');
    expect(voiceKeyFromLocalizedRelPath('Sound/Voice/DLCRobot.esm/Npc/000219CF_2.wav', 'fo4')).toBe(
      'dlcrobot.esm/0219CF:2',
    );
  });

  it('gives a bare file name an unqualified key', () => {
    expect(voiceKeyFromLocalizedRelPath('00123456_1.fuz', 'fo4')).toBe('123456:1');
    expect(voiceKeyFromLocalizedRelPath('000219CF_2.wav', 'fo4')).toBe('0219CF:2');
  });

  it('rejects leftover names that are not voice takes', () => {
    expect(voiceKeyFromLocalizedRelPath('extra.fuz', 'fo4')).toBeNull();
    expect(voiceKeyFromLocalizedRelPath('readme.txt', 'fo4')).toBeNull();
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
