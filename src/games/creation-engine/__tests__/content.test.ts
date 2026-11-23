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

describe('Starfield content classifier', () => {
  const classify = (name: string) => gamePlugin('sf1').content!.classify(name);

  it.each([
    ['Starfield.esm', 'base'],
    ['ShatteredSpace.esm', 'dlc'],
    ['SFBGS050.esm', 'dlc'],
    ['sfbgs003.esm', 'dlc'],
    ['Constellation.esm', 'dlc'],
    ['BlueprintShips-Starfield.esm', 'dlc'],
    ['sfbgs009.esm', 'addon'],
    ['sfbgs00a_a.esm', 'addon'],
    ['SFTA01.esm', 'addon'],
    ['blueprintships-sfta03.esm', 'addon'],
    ['StarfieldCommunityPatch.esm', 'mod'],
    // `cc` is Fallout 4 and Skyrim's store, not Starfield's.
    ['ccSomeMod.esm', 'mod'],
    ['sfbgs009 - Main.ba2', 'mod'],
  ])('%s is %s', (name, kind) => {
    expect(classify(name)).toBe(kind);
  });
});
