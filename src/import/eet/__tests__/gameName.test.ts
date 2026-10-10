import { describe, expect, it } from '@jest/globals';
import { eetNamesOtherGame, gamesNamedByEet } from '../gameName';

describe('the game an EET header names', () => {
  it.each([
    ['Fallout 4', ['fo4']],
    ['Fallout4', ['fo4']],
    ['Fallout 3', ['fo3']],
    ['Fallout: New Vegas', ['fnv']],
    ['FalloutNV', ['fnv']],
    ['Skyrim', ['sse', 'sle']],
    ['SkyrimSE', ['sse']],
    ['Skyrim Special Edition', ['sse']],
    ['Oblivion', ['ob']],
    ['Morrowind', ['mw']],
    ['Starfield', []],
    ['', []],
  ])('reads %j as %j', (name, games) => {
    expect([...gamesNamedByEet(name)].sort()).toEqual([...games].sort());
  });

  it('is another game only when the name rules the page game out', () => {
    expect(eetNamesOtherGame('Skyrim', 'fo4')).toBe(true);
    expect(eetNamesOtherGame('Fallout 4', 'fo4')).toBe(false);
    expect(eetNamesOtherGame('Skyrim', 'sle')).toBe(false);
    // Skyrim LE keeps its text under Skyrim SE's key: one game for this purpose.
    expect(eetNamesOtherGame('SkyrimSE', 'sle')).toBe(false);
  });

  it('proves nothing from a name no game claims', () => {
    expect(eetNamesOtherGame('Starfield', 'fo4')).toBe(false);
    expect(eetNamesOtherGame('', 'sse')).toBe(false);
  });
});
