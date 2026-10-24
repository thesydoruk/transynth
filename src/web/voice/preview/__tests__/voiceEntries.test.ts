import { findVoiceEntry, formatVoiceSpeakerLabel } from '../voiceEntries';
import type { VoiceFileEntry } from '../../../../voice/discoverVoiceFiles';

const entry = (speaker: string, lineKey: string): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/00${lineKey}_1.fuz`,
  absolutePath: `/data/${speaker}/00${lineKey}_1.fuz`,
  fileName: `00${lineKey}_1.fuz`,
  lineKey,
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

describe('findVoiceEntry origin filter', () => {
  const voiceRootRel = 'Sound/Voice/Patch.esp';
  const withOrigin = (origin: string, folder: string): VoiceFileEntry => ({
    relPath: `Sound/Voice/${folder}/MaleRough/00019EE0_1.fuz`,
    absolutePath: `/data/${folder}/MaleRough/00019EE0_1.fuz`,
    fileName: '00019EE0_1.fuz',
    lineKey: '019EE0',
    variant: 1,
    ext: 'fuz',
    originPlugin: origin,
  });
  const files = [
    withOrigin('dlcrobot.esm', 'DLCRobot.esm'),
    withOrigin('fallout4.esm', 'Fallout4.esm'),
  ];

  it('picks the take of the requested origin', () => {
    expect(
      findVoiceEntry(files, '019EE0', 1, { voiceRootRel, originPlugin: 'Fallout4.esm' })?.relPath,
    ).toContain('Fallout4.esm');
    expect(
      findVoiceEntry(files, '019EE0', 1, { voiceRootRel, originPlugin: 'dlcrobot.esm' })?.relPath,
    ).toContain('DLCRobot.esm');
  });

  it('finds nothing for an origin with no such take', () => {
    expect(
      findVoiceEntry(files, '019EE0', 1, { voiceRootRel, originPlugin: 'patch.esp' }),
    ).toBeUndefined();
  });

  it('matches the first take when no origin is requested', () => {
    expect(findVoiceEntry(files, '019EE0', 1, { voiceRootRel })?.relPath).toContain('DLCRobot.esm');
    expect(findVoiceEntry(files, '019EE0', 1, { voiceRootRel, originPlugin: null })).toBeDefined();
  });

  it('combines origin and speaker', () => {
    expect(
      findVoiceEntry(files, '019EE0', 1, {
        voiceRootRel,
        originPlugin: 'fallout4.esm',
        speakerKey: 'FemaleRough',
      }),
    ).toBeUndefined();
  });
});
