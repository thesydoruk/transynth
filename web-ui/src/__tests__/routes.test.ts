import { describe, expect, it } from 'vitest';
import { GAME_SECTIONS, routes } from '../routes';

describe('routes', () => {
  it('puts the mods section at the game address and the others under it', () => {
    expect(routes.gameSection('fo4', 'mods')).toBe('/games/fo4');
    expect(
      GAME_SECTIONS.filter((s) => s !== 'mods').map((s) => routes.gameSection('fo4', s)),
    ).toEqual([
      '/games/fo4/nexus',
      '/games/fo4/coherence',
      '/games/fo4/diff',
      '/games/fo4/reference',
      '/games/fo4/glossary',
      '/games/fo4/vortex',
    ]);
  });

  it('builds mod addresses with an optional query', () => {
    expect(routes.mod('fo4', 7)).toBe('/games/fo4/mods/7');
    expect(routes.mod('fo4', 7, { status: 'draft', signature: '' })).toBe(
      '/games/fo4/mods/7?status=draft',
    );
    expect(routes.modInnr('fo4', 7)).toBe('/games/fo4/mods/7/innr');
    expect(routes.nexusMod('fo4', 4598)).toBe('/games/fo4/nexus/4598');
  });

  it('keeps only the chosen mods in a diff address', () => {
    expect(routes.diff('fo4')).toBe('/games/fo4/diff');
    expect(routes.diff('fo4', { newModId: 9, oldModId: 4 })).toBe(
      '/games/fo4/diff?newModId=9&oldModId=4',
    );
  });

  it('escapes a game id and names a settings tab', () => {
    expect(routes.game('a b')).toBe('/games/a%20b');
    expect(routes.settings()).toBe('/settings');
    expect(routes.settings('activity', { entityType: 'mod', entityId: 3 })).toBe(
      '/settings?tab=activity&entityType=mod&entityId=3',
    );
  });
});
