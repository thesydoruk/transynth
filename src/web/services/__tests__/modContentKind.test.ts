import { describe, expect, it } from '@jest/globals';
import { resolveModContentKind } from '../modContentKind';

describe('resolveModContentKind', () => {
  it('classifies by the anchor file, on either path separator', () => {
    const base = { game: 'fo4', content_kind: null };
    expect(resolveModContentKind({ ...base, abs_path: 'C:\\Data\\Fallout4.esm' })).toEqual({
      kind: 'base',
      manual: false,
    });
    expect(resolveModContentKind({ ...base, abs_path: '/data/DLCCoast.esm' }).kind).toBe('dlc');
    expect(resolveModContentKind({ ...base, abs_path: '/data/ccFoo.esl' }).kind).toBe('addon');
    expect(resolveModContentKind({ ...base, abs_path: '/data/MyMod.esp' }).kind).toBe('mod');
  });

  it('lets a stored kind win and ignores an invalid one', () => {
    const mod = { game: 'fo4', abs_path: '/d/Fallout4.esm' };
    expect(resolveModContentKind({ ...mod, content_kind: 'mod' })).toEqual({
      kind: 'mod',
      manual: true,
    });
    expect(resolveModContentKind({ ...mod, content_kind: 'junk' })).toEqual({
      kind: 'base',
      manual: false,
    });
  });

  it('answers mod without a path or an adapter', () => {
    expect(resolveModContentKind({ game: 'fo4', abs_path: null, content_kind: null }).kind).toBe(
      'mod',
    );
    expect(
      resolveModContentKind({ game: 'w3', abs_path: '/d/Fallout4.esm', content_kind: null }).kind,
    ).toBe('mod');
  });
});
