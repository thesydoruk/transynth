import {
  lookupVoiceSynthesisVersion,
  normalizeVoiceSpeakerKey,
  speakerKeyFromVoiceRelPath,
  voiceSynthesisStateKey,
} from '../voiceSynthesisState';

describe('normalizeVoiceSpeakerKey', () => {
  it('trims folder names and treats missing as empty', () => {
    expect(normalizeVoiceSpeakerKey(' PlayerVoiceMale01 ')).toBe('PlayerVoiceMale01');
    expect(normalizeVoiceSpeakerKey(null)).toBe('');
    expect(normalizeVoiceSpeakerKey(undefined)).toBe('');
  });
});

describe('voiceSynthesisStateKey', () => {
  it('keeps Nate and Nora takes on the same FormID apart', () => {
    expect(voiceSynthesisStateKey('PlayerVoiceMale01', '005825', 1)).toBe(
      'PlayerVoiceMale01:005825:1',
    );
    expect(voiceSynthesisStateKey('PlayerVoiceFemale01', '005825', 1)).toBe(
      'PlayerVoiceFemale01:005825:1',
    );
  });

  it('uppercases FormID and normalizes a missing speaker', () => {
    expect(voiceSynthesisStateKey('  ', '005825', 2)).toBe(':005825:2');
    expect(voiceSynthesisStateKey(undefined, '58', 1)).toBe(':58:1');
  });
});

describe('lookupVoiceSynthesisVersion', () => {
  const map = new Map([
    [voiceSynthesisStateKey('PlayerVoiceMale01', '005825', 1), 'male-hash'],
    [voiceSynthesisStateKey('', '00ABCD', 2), 'legacy-hash'],
  ]);

  it('prefers the per-speaker stamp', () => {
    expect(lookupVoiceSynthesisVersion(map, 'PlayerVoiceMale01', '005825', 1)).toBe('male-hash');
  });

  it('falls back to a pre-speaker_key row when the folder stamp is missing', () => {
    expect(lookupVoiceSynthesisVersion(map, 'PlayerVoiceFemale01', '00ABCD', 2)).toBe(
      'legacy-hash',
    );
  });

  it('does not invent a stamp when neither row exists', () => {
    expect(lookupVoiceSynthesisVersion(map, 'PlayerVoiceMale01', '00FFFF', 1)).toBeNull();
  });

  it('does not use a legacy stamp when a per-speaker row already exists', () => {
    const both = new Map([
      [voiceSynthesisStateKey('PlayerVoiceMale01', '005825', 1), 'male-hash'],
      [voiceSynthesisStateKey('', '005825', 1), 'legacy-hash'],
    ]);
    expect(lookupVoiceSynthesisVersion(both, 'PlayerVoiceMale01', '005825', 1)).toBe('male-hash');
  });
});

describe('speakerKeyFromVoiceRelPath', () => {
  it('reads the speaker folder from a Fallout 4 voice path', () => {
    expect(
      speakerKeyFromVoiceRelPath('Sound/Voice/Fallout4.esm/PlayerVoiceMale01/00005825_1.fuz'),
    ).toBe('PlayerVoiceMale01');
    expect(
      speakerKeyFromVoiceRelPath(
        'Data\\Sound\\Voice\\Fallout4.esm\\PlayerVoiceFemale01\\00005825_1.fuz',
      ),
    ).toBe('PlayerVoiceFemale01');
  });

  it('returns empty when there is no speaker folder', () => {
    expect(speakerKeyFromVoiceRelPath('00005825_1.fuz')).toBe('');
  });
});
