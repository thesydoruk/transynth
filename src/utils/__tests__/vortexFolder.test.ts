import { parseVortexModFolder } from '../vortexFolder';

describe('parseVortexModFolder', () => {
  it('parses standard Vortex folders with timestamp', () => {
    expect(parseVortexModFolder('FallUI - Inventory-48758-2-2-1-1666954336')).toEqual({
      folderName: 'FallUI - Inventory-48758-2-2-1-1666954336',
      modName: 'FallUI - Inventory',
      nexusModId: 48758,
    });
  });

  it('parses mod names that contain hyphens', () => {
    expect(parseVortexModFolder('A Forest - True Grass-62073-1-1657445287')).toEqual({
      folderName: 'A Forest - True Grass-62073-1-1657445287',
      modName: 'A Forest - True Grass',
      nexusModId: 62073,
    });
  });

  it('parses folders without timestamp', () => {
    expect(parseVortexModFolder('Longer Power Lines 3x-2241-1-1')).toEqual({
      folderName: 'Longer Power Lines 3x-2241-1-1',
      modName: 'Longer Power Lines 3x',
      nexusModId: 2241,
    });
  });

  it('parses two-part numeric suffixes', () => {
    expect(parseVortexModFolder('Loot Detector (ESP for NMM)-4380-3800')).toEqual({
      folderName: 'Loot Detector (ESP for NMM)-4380-3800',
      modName: 'Loot Detector (ESP for NMM)',
      nexusModId: 4380,
    });
  });

  it('parses alphanumeric version tails', () => {
    expect(parseVortexModFolder('HUDFramework 1.0f-20309-1-0f')).toEqual({
      folderName: 'HUDFramework 1.0f-20309-1-0f',
      modName: 'HUDFramework 1.0f',
      nexusModId: 20309,
    });
  });

  it('returns null for non-Vortex folders', () => {
    expect(parseVortexModFolder('Creation Club - Captain Cosmos')).toBeNull();
    expect(parseVortexModFolder('enbseries_fallout4_v0501')).toBeNull();
  });
});
