import { describe, expect, it } from '@jest/globals';
import { gamePlugin } from '../../registry';

describe('Creation Engine content classifier', () => {
  const classify = (name: string) => gamePlugin('fo4').content!.classify(name);

  it.each([
    ['Fallout4.esm', 'base'],
    ['DLCCoast.esm', 'dlc'],
    ['dlcrobot.ESM', 'dlc'],
    ['ccBGSFO4044-HellfirePowerArmor.esl', 'addon'],
    ['unofficial fallout 4 patch.esp', 'mod'],
    ['Translate_en.txt', 'mod'],
  ])('%s is %s', (name, kind) => {
    expect(classify(name)).toBe(kind);
  });
});
