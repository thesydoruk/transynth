import { describe, expect, it } from '@jest/globals';
import { vortexPluginKey } from '../family';

describe('vortexPluginKey', () => {
  it.each([
    ['/app/data/uploads/vortex/1/v1_abc/FallUI - Inventory.esp', 'fallui - inventory.esp'],
    ['C:\\Games\\Fallout 4\\Data\\Fallout4.ESM', 'fallout4.esm'],
    ['DLCCoast.esl', 'dlccoast.esl'],
  ])('lower-cases the plugin file of %s', (filePath, key) => {
    expect(vortexPluginKey(filePath)).toBe(key);
  });

  it.each([
    ['/app/data/uploads/vortex/1/v1_abc/Interface/FallUI HUD/Translation/Translate_en.txt'],
    ['/app/data/uploads/vortex/1/v1_abc/MCM/Config/FallUI'],
    [''],
    [null],
  ])('is null for a plugin-less anchor %p', (filePath) => {
    expect(vortexPluginKey(filePath)).toBeNull();
  });
});
