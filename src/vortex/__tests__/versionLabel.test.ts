import { inferModVersionLabel } from '../versionLabel';

describe('inferModVersionLabel', () => {
  it('uses the game release for official masters', () => {
    expect(
      inferModVersionLabel({
        channel: 'game',
        gameReleaseLabel: '1.11.240.0',
        contentHash: 'aaaaaaaaaaaaaaaa',
      }),
    ).toBe('1.11.240.0');
  });

  it('parses a Vortex staging folder version', () => {
    expect(
      inferModVersionLabel({
        channel: 'mods',
        sourceFolder: 'FallUI - Inventory-48758-2-2-1-1666954336',
        contentHash: 'bbbbbbbbbbbbbbbb',
      }),
    ).toBe('2.2.1');
  });

  it('picks a dotted version out of a non-Vortex folder name', () => {
    expect(
      inferModVersionLabel({
        channel: 'mods',
        sourceFolder: 'Unofficial Fallout 4 Patch 4598 2.2.2a 2026-08-18T21-17Z seiQXqqfJ',
        contentHash: 'cccccccccccccccc',
      }),
    ).toBe('2.2.2a');
  });

  it('falls back to a short content hash', () => {
    expect(
      inferModVersionLabel({
        channel: 'mods',
        sourceFolder: 'Creation Club - Captain Cosmos',
        contentHash: '0123456789abcdef',
      }),
    ).toBe('0123456789ab');
  });
});
