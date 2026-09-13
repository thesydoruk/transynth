import { scopedVortexFileHash, vortexGroupKey, vortexGroupLabel } from '../groupKey';

describe('vortexGroupKey', () => {
  it('normalizes slashes and case', () => {
    expect(vortexGroupKey('fo4', 'D:\\Vortex Mods\\fallout4\\')).toBe(
      vortexGroupKey('fo4', 'd:/vortex mods/fallout4'),
    );
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
