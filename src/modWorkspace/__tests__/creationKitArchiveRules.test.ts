import {
  classifyBa2Archive,
  isStringsTablePath,
  shouldCompressArchiveEntry,
  shouldCompressBa2Entry,
  shouldCompressBsaEntry,
} from '../creationKitArchiveRules';

describe('creationKitArchiveRules', () => {
  it('detects string table paths', () => {
    expect(isStringsTablePath('Strings\\Mod_en.STRINGS')).toBe(true);
    expect(isStringsTablePath('strings/mod_ru.dlstrings')).toBe(true);
    expect(isStringsTablePath('Meshes\\Armor.nif')).toBe(false);
  });

  it('classifies FO4 BA2 archives by Creation Kit suffix', () => {
    expect(classifyBa2Archive('MyMod - Main.ba2')).toBe('main');
    expect(classifyBa2Archive('MyMod - Interface.ba2')).toBe('interface');
    expect(classifyBa2Archive('MyMod - Voices.ba2')).toBe('voices');
    expect(classifyBa2Archive('MyMod - Textures.ba2')).toBe('textures');
  });

  it('compresses Main assets but not string tables', () => {
    expect(shouldCompressBa2Entry('MyMod - Main.ba2', 'Strings\\Mod_uk.STRINGS')).toBe(false);
    expect(shouldCompressBa2Entry('MyMod - Main.ba2', 'Meshes\\Armor.nif')).toBe(true);
    expect(shouldCompressBa2Entry('MyMod - Interface.ba2', 'Scripts\\Foo.pex')).toBe(true);
  });

  it('never compresses Voices archives', () => {
    expect(shouldCompressBa2Entry('MyMod - Voices.ba2', 'Sound\\Voice\\Line.fuz')).toBe(false);
  });

  it('compresses BSA assets except string tables', () => {
    expect(shouldCompressBsaEntry('MyMod - Strings.bsa', 'strings\\mod_en.strings')).toBe(false);
    expect(shouldCompressBsaEntry('MyMod - Strings.bsa', 'meshes\\a.nif')).toBe(true);
  });

  it('routes by archive type and game', () => {
    expect(shouldCompressArchiveEntry('ba2', 'Mod - Main.ba2', 'Meshes\\x.nif', 'fo4')).toBe(true);
    expect(
      shouldCompressArchiveEntry('bsa', 'Mod - Strings.bsa', 'strings\\x.strings', 'sse'),
    ).toBe(false);
  });
});
