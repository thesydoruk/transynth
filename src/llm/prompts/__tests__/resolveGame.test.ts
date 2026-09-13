import { describe, expect, it } from '@jest/globals';
import { glossaryGameKey, resolveGameType } from '../resolveGame';

describe('resolveGameType', () => {
  it('keeps known games and defaults unknown to fo4', () => {
    expect(resolveGameType('sse')).toBe('sse');
    expect(resolveGameType('sle')).toBe('sle');
    expect(resolveGameType(undefined)).toBe('fo4');
    expect(resolveGameType('nope')).toBe('fo4');
  });
});

describe('glossaryGameKey', () => {
  it('stores Skyrim LE under the SSE glossary', () => {
    expect(glossaryGameKey('sle')).toBe('sse');
    expect(glossaryGameKey('sse')).toBe('sse');
  });

  it('keeps other games distinct', () => {
    expect(glossaryGameKey('fo4')).toBe('fo4');
    expect(glossaryGameKey('fo3')).toBe('fo3');
    expect(glossaryGameKey('disco')).toBe('disco');
  });
});
