import { referenceOriginKey, type ModOriginSource } from '../referenceOrigin';

const mod = (over: Partial<ModOriginSource>): ModOriginSource => ({
  name: 'Some Mod',
  abs_path: null,
  vortex_plugin: null,
  game: 'fo4',
  ...over,
});

describe('referenceOriginKey', () => {
  it('is the plugin a Vortex mod is anchored on, whatever the folder is called', () => {
    const first = mod({
      name: 'Unofficial Fallout 4 Patch-4598-2-2-1a-1779927834',
      vortex_plugin: 'unofficial fallout 4 patch.esp',
    });
    const renamed = mod({
      name: 'unofficial fallout 4 patch',
      vortex_plugin: 'Unofficial Fallout 4 Patch.esp ',
    });

    expect(referenceOriginKey(first)).toBe('unofficial fallout 4 patch.esp');
    expect(referenceOriginKey(renamed)).toBe('unofficial fallout 4 patch.esp');
  });

  it('is the plugin file of a hand-imported mod, lower-cased, from either path style', () => {
    expect(referenceOriginKey(mod({ abs_path: '/data/mods/12/Fallout4.esm' }))).toBe(
      'fallout4.esm',
    );
    expect(referenceOriginKey(mod({ abs_path: 'D:\\Games\\Data\\DLCCoast.ESM' }))).toBe(
      'dlccoast.esm',
    );
  });

  it('falls back to the mod name when the anchor is not a plugin of the game', () => {
    // A strings-only or interface-only Creation Engine mod.
    expect(referenceOriginKey(mod({ name: ' FallUI HUD ', abs_path: '/m/Interface/hud.swf' }))).toBe(
      'fallui hud',
    );
    // A game with no plugin files: its anchor never names a layer.
    expect(
      referenceOriginKey(
        mod({ name: 'Disco Elysium', game: 'disco', abs_path: '/m/disco/base.esm' }),
      ),
    ).toBe('disco elysium');
    expect(referenceOriginKey(mod({ name: 'No Anchor' }))).toBe('no anchor');
  });
});
