import { describe, expect, it } from '@jest/globals';
import {
  diffWatchSnapshots,
  exportOrderSignature,
  orderFilesSignature,
  stagingSignature,
  unitsSignature,
  watchSignature,
} from '../changeDetector';

describe('change detector signatures', () => {
  it('ignores entry order and folder-name case, notices a new folder or a touched one', () => {
    const a = stagingSignature([
      { name: 'Foo-1-0', mtimeMs: 100 },
      { name: 'bar-2-0', mtimeMs: 200 },
    ]);
    expect(
      stagingSignature([
        { name: 'BAR-2-0', mtimeMs: 200 },
        { name: 'foo-1-0', mtimeMs: 100 },
      ]),
    ).toBe(a);
    expect(
      stagingSignature([
        { name: 'Foo-1-0', mtimeMs: 100 },
        { name: 'bar-2-0', mtimeMs: 201 },
      ]),
    ).not.toBe(a);
    expect(
      stagingSignature([
        { name: 'Foo-1-0', mtimeMs: 100 },
        { name: 'bar-2-0', mtimeMs: 200 },
        { name: 'Baz-3-0', mtimeMs: 300 },
      ]),
    ).not.toBe(a);
  });

  it('keys order files on size and mtime, units on id and content hash', () => {
    const f = orderFilesSignature([{ path: 'C:/x/plugins.txt', size: 10, mtimeMs: 5 }]);
    expect(orderFilesSignature([{ path: 'c:/X/plugins.txt', size: 10, mtimeMs: 5 }])).toBe(f);
    expect(orderFilesSignature([{ path: 'C:/x/plugins.txt', size: 11, mtimeMs: 5 }])).not.toBe(f);
    const u = unitsSignature([{ unitId: 'mods:a:a', contentHash: 'h1' }]);
    expect(unitsSignature([{ unitId: 'mods:a:a', contentHash: 'h2' }])).not.toBe(u);
  });

  it('sees the export order as the same when only casing differs', () => {
    const base = {
      plugins: ['Fallout4.esm', 'Foo.esp'],
      enabledPlugins: ['Foo.esp'],
      fileWinners: [{ path: 'Data/Foo.esp', sourceFolder: 'Foo-1-0' }],
    };
    expect(exportOrderSignature({ ...base, plugins: ['fallout4.esm', 'FOO.esp'] })).toBe(
      exportOrderSignature(base),
    );
    expect(exportOrderSignature({ ...base, plugins: ['Foo.esp', 'Fallout4.esm'] })).not.toBe(
      exportOrderSignature(base),
    );
    expect(exportOrderSignature({ ...base, fileWinners: [] })).not.toBe(exportOrderSignature(base));
  });

  it('diffs snapshots per part', () => {
    const prev = { staging: 's1', order: 'o1', takenAt: 't' };
    expect(diffWatchSnapshots(null, prev)).toEqual({ staging: true, order: true, any: true });
    expect(diffWatchSnapshots(prev, { ...prev, order: 'o2' })).toEqual({
      staging: false,
      order: true,
      any: true,
    });
    expect(diffWatchSnapshots(prev, { ...prev, takenAt: 'later' }).any).toBe(false);
    expect(watchSignature(prev)).toBe('s1:o1');
  });
});
