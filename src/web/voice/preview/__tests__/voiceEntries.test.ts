import { findVoiceEntry, formatVoiceSpeakerLabel } from '../voiceEntries';
import type { VoiceFileEntry } from '../../../../voice/discoverVoiceFiles';

const entry = (speaker: string, formidLower6: string): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/00${formidLower6}_1.fuz`,
  absolutePath: `/data/${speaker}/00${formidLower6}_1.fuz`,
  fileName: `00${formidLower6}_1.fuz`,
  formidLower6,
  variant: 1,
  ext: 'fuz',
});

describe('formatVoiceSpeakerLabel', () => {
  it('keeps Nate and Nora as distinct player labels', () => {
    expect(formatVoiceSpeakerLabel('PlayerVoiceMale01')).toBe('Player Male');
    expect(formatVoiceSpeakerLabel('PlayerVoiceFemale01')).toBe('Player Female');
  });
});

describe('findVoiceEntry', () => {
  const voiceRootRel = 'Sound/Voice/Fallout4.esm';
  const files = [entry('PlayerVoiceMale01', '005825'), entry('PlayerVoiceFemale01', '005825')];

  it('picks the speaker the caller asked for when two takes share a FormID', () => {
    const nate = findVoiceEntry(files, '005825', 1, {
      voiceRootRel,
      speakerKey: 'PlayerVoiceMale01',
    });
    const nora = findVoiceEntry(files, '005825', 1, {
      voiceRootRel,
      speakerKey: 'PlayerVoiceFemale01',
    });

    expect(nate?.relPath).toContain('PlayerVoiceMale01');
    expect(nora?.relPath).toContain('PlayerVoiceFemale01');
  });
});
