import { describe, expect, it } from '@jest/globals';
import { pickPrimaryPlugin } from '../primaryPlugin';

const base = ['Fallout4.esm', 'DLCRobot.esm'];

describe('pickPrimaryPlugin', () => {
  it('picks the plugin the others build on (Sim Settlements 2)', () => {
    expect(
      pickPrimaryPlugin([
        { fileName: 'SS2Extended.esp', masters: [...base, 'SS2.esm'] },
        { fileName: 'SS2_XPAC_Chapter2.esm', masters: [...base, 'SS2.esm'] },
        {
          fileName: 'SS2_XPAC_Chapter3.esm',
          masters: [...base, 'ss2.esm', 'SS2_XPAC_Chapter2.esm'],
        },
        { fileName: 'SS2.esm', masters: base },
      ]),
    ).toBe('SS2.esm');
  });

  it('falls back to a master file, then the shortest name, when no plugin names another', () => {
    expect(
      pickPrimaryPlugin([
        { fileName: 'Mod Patch.esp', masters: base },
        { fileName: 'ModLong.esm', masters: base },
        { fileName: 'Mod.esm', masters: base },
      ]),
    ).toBe('Mod.esm');
  });

  it('is null for a folder without plugins and the plugin itself for one', () => {
    expect(pickPrimaryPlugin([])).toBeNull();
    expect(pickPrimaryPlugin([{ fileName: 'Only.esp', masters: [] }])).toBe('Only.esp');
  });
});
