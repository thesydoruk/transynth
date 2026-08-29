import { describe, expect, it } from '@jest/globals';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import { outputLocalizedFuzRelPath } from '../voiceFilePaths';

const entry = (relPath: string, fileName: string): VoiceFileEntry => ({
  relPath,
  absolutePath: `/pkg/${relPath}`,
  fileName,
  formidLower6: '002CBA',
  variant: 4,
  ext: 'fuz',
});

describe('outputLocalizedFuzRelPath', () => {
  it('mirrors the game voice path with a .fuz extension', () => {
    expect(
      outputLocalizedFuzRelPath(
        entry('Data/Sound/Voice/Mod.esp/AlexanderBrown/00002CBA_4.fuz', '00002CBA_4.fuz'),
      ),
    ).toBe('Data/Sound/Voice/Mod.esp/AlexanderBrown/00002CBA_4.fuz');
  });

  it('normalizes xwm sources to .fuz output paths', () => {
    expect(
      outputLocalizedFuzRelPath(entry('Sound/Voice/Mod.esp/NPC/00001EFF_1.xwm', '00001EFF_1.xwm')),
    ).toBe('Sound/Voice/Mod.esp/NPC/00001EFF_1.fuz');
  });
});
