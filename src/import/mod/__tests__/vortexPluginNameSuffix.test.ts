import { describe, expect, it } from '@jest/globals';
import { vortexPluginNameSuffix } from '../run/context';

describe('vortexPluginNameSuffix', () => {
  it('names the plugin for a job of a multi-plugin folder', () => {
    expect(
      vortexPluginNameSuffix({
        file_hash: 'v1:88a2f33c01a6d1247b45d9875dd354a72338563a:ss2_xpac_chapter2',
        esp_path: '/app/data/uploads/vortex/1/v1_88a2/SS2_XPAC_Chapter2.esm',
      }),
    ).toBe(' · SS2_XPAC_Chapter2');
  });

  it.each([
    ['a one-plugin Vortex unit', 'v1:88a2f33c01a6d1247b45d9875dd354a72338563a'],
    ['a manual upload', 'ec3353e9be226911f5a23d1e180eaddd7c6af0d1'],
  ])('adds nothing for %s', (_label, fileHash) => {
    expect(vortexPluginNameSuffix({ file_hash: fileHash, esp_path: '/x/Mod.esp' })).toBe('');
  });
});
