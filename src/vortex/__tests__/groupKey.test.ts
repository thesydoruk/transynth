import {
  scopedVortexFileHash,
  vortexGroupAnchor,
  vortexGroupKey,
  vortexGroupLabel,
} from '../groupKey';

describe('vortexGroupKey', () => {
  it('normalizes slashes and case', () => {
    expect(vortexGroupKey('fo4', 'D:\\Vortex Mods\\fallout4\\')).toBe(
      vortexGroupKey('fo4', 'd:/vortex mods/fallout4'),
    );
  });

  // Two computers, two Windows user names, one group.
  it('keys a group on the `group` setting when an agent has one', () => {
    const desk = 'C:\\Users\\alice\\AppData\\Roaming\\Vortex\\fallout4\\mods';
    const laptop = 'C:\\Users\\bob\\AppData\\Roaming\\Vortex\\fallout4\\mods';
    const key = (staging: string, group?: string) =>
      vortexGroupKey('fo4', vortexGroupAnchor(staging, group));

    expect(key(laptop)).not.toBe(key(desk));
    // The laptop names the desk's staging folder: the desk needs no setting at all.
    expect(key(laptop, ` ${desk} `)).toBe(key(desk));
    expect(vortexGroupLabel(vortexGroupAnchor(laptop, desk), 'fo4')).toBe('Vortex · fallout4');
    // Or both name the same thing.
    expect(key(laptop, 'Home')).toBe(key(desk, 'home'));
    expect(key(desk, 'home')).toBe('fo4:home');
    expect(vortexGroupLabel(vortexGroupAnchor(desk, 'home'), 'fo4')).toBe('Vortex · home');
    expect(vortexGroupAnchor(desk, '  ')).toBe(desk);
  });

  it('scopes file hashes to a group', () => {
    expect(scopedVortexFileHash(3, 'abc')).toBe('v3:abc');
  });

  it('labels a Vortex staging tree instead of the mods folder name', () => {
    expect(
      vortexGroupLabel('C:\\Users\\valer\\AppData\\Roaming\\Vortex\\fallout4\\mods', 'fo4'),
    ).toBe('Vortex · fallout4');
    expect(vortexGroupLabel('D:\\Vortex Mods\\Cool Collection', 'fo4')).toBe(
      'Vortex · Cool Collection',
    );
  });
});
