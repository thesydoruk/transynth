import { dedupeVoiceFiles, type VoiceFileEntry } from '../discoverVoiceFiles';

const entry = (
  speaker: string,
  formid: string,
  variant: number,
  ext: VoiceFileEntry['ext'] = 'fuz',
): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/${formid}_${variant}.${ext}`,
  absolutePath: `/data/${speaker}/${formid}_${variant}.${ext}`,
  fileName: `${formid}_${variant}.${ext}`,
  formidLower6: formid.substring(2).toUpperCase(),
  variant,
  ext,
});

describe('dedupeVoiceFiles', () => {
  it('keeps Nate and Nora takes of the same INFO FormID', () => {
    const kept = dedupeVoiceFiles([
      entry('PlayerVoiceMale01', '00005825', 1),
      entry('PlayerVoiceFemale01', '00005825', 1),
    ]);

    expect(kept.map((row) => row.relPath).sort()).toEqual([
      'Sound/Voice/Fallout4.esm/PlayerVoiceFemale01/00005825_1.fuz',
      'Sound/Voice/Fallout4.esm/PlayerVoiceMale01/00005825_1.fuz',
    ]);
  });

  it('still prefers fuz over wav inside one speaker folder', () => {
    const kept = dedupeVoiceFiles([
      entry('PlayerVoiceMale01', '00005825', 1, 'wav'),
      entry('PlayerVoiceMale01', '00005825', 1, 'fuz'),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.ext).toBe('fuz');
  });
});
