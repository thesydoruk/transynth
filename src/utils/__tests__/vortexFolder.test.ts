import { formatVortexVersionTail, parseVortexModFolder } from '../vortexFolder';

describe('parseVortexModFolder', () => {
  it('parses standard Vortex folders with timestamp', () => {
    expect(parseVortexModFolder('FallUI - Inventory-48758-2-2-1-1666954336')).toEqual({
      folderName: 'FallUI - Inventory-48758-2-2-1-1666954336',
      modName: 'FallUI - Inventory',
      nexusModId: 48758,
      version: '2.2.1',
    });
  });

  it('parses mod names that contain hyphens', () => {
    expect(parseVortexModFolder('A Forest - True Grass-62073-1-1657445287')).toEqual({
      folderName: 'A Forest - True Grass-62073-1-1657445287',
      modName: 'A Forest - True Grass',
      nexusModId: 62073,
      version: '1',
    });
  });

  it('parses folders without timestamp', () => {
    expect(parseVortexModFolder('Longer Power Lines 3x-2241-1-1')).toEqual({
      folderName: 'Longer Power Lines 3x-2241-1-1',
      modName: 'Longer Power Lines 3x',
      nexusModId: 2241,
      version: '1.1',
    });
  });

  it('parses two-part numeric suffixes', () => {
    expect(parseVortexModFolder('Loot Detector (ESP for NMM)-4380-3800')).toEqual({
      folderName: 'Loot Detector (ESP for NMM)-4380-3800',
      modName: 'Loot Detector (ESP for NMM)',
      nexusModId: 4380,
      version: '3800',
    });
  });

  it('parses alphanumeric version tails', () => {
    expect(parseVortexModFolder('HUDFramework 1.0f-20309-1-0f')).toEqual({
      folderName: 'HUDFramework 1.0f-20309-1-0f',
      modName: 'HUDFramework 1.0f',
      nexusModId: 20309,
      version: '1.0f',
    });
  });

  it('parses the newer space-separated format', () => {
    const folder = 'Sim Settlements 2 - All Chapters Pack 73394 3.8.1a 2026-10-27T05-48Z 86DAb3Tia';
    expect(parseVortexModFolder(folder)).toEqual({
      folderName: folder,
      modName: 'Sim Settlements 2 - All Chapters Pack',
      nexusModId: 73394,
      version: '3.8.1a',
    });
  });

  it('parses newer-format names that end in a number', () => {
    const folder = 'Unofficial Fallout 4 Patch 4598 2.2.2a 2026-08-18T21-17Z seiqXqqfJ';
    expect(parseVortexModFolder(folder)).toEqual({
      folderName: folder,
      modName: 'Unofficial Fallout 4 Patch',
      nexusModId: 4598,
      version: '2.2.2a',
    });
  });

  it('parses a plain newer-format folder', () => {
    const folder = 'Workshop Framework 35004 2.6.1 2026-10-02T07-49Z mlhIZeBse';
    expect(parseVortexModFolder(folder)).toEqual({
      folderName: folder,
      modName: 'Workshop Framework',
      nexusModId: 35004,
      version: '2.6.1',
    });
  });

  it('returns null for non-Vortex folders', () => {
    expect(parseVortexModFolder('Creation Club - Captain Cosmos')).toBeNull();
    expect(parseVortexModFolder('enbseries_fallout4_v0501')).toBeNull();
    expect(parseVortexModFolder('Workshop Framework 2.6.1')).toBeNull();
    expect(
      parseVortexModFolder('Workshop Framework 0 2.6.1 2026-10-02T07-49Z mlhIZeBse'),
    ).toBeNull();
  });
});

describe('formatVortexVersionTail', () => {
  it('turns hyphenated numeric parts into dots', () => {
    expect(formatVortexVersionTail('2-2-1')).toBe('2.2.1');
  });

  it('keeps dotted versions', () => {
    expect(formatVortexVersionTail('2.2.2a')).toBe('2.2.2a');
  });
});
