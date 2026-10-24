import {
  lookupVoiceSimilarity,
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

describe('voiceSynthesisStateKey with origin', () => {
  it('prefixes the lower-cased origin', () => {
    expect(voiceSynthesisStateKey('MaleRough', '19ee0c', 1, 'Fallout4.esm')).toBe(
      'fallout4.esm/MaleRough:19EE0C:1',
    );
  });

  it('keeps the same speaker and FormID apart across origins', () => {
    expect(voiceSynthesisStateKey('MaleRough', '19EE0C', 1, 'fallout4.esm')).not.toBe(
      voiceSynthesisStateKey('MaleRough', '19EE0C', 1, 'dlcrobot.esm'),
    );
  });

  it('is the legacy key without an origin', () => {
    expect(voiceSynthesisStateKey('MaleRough', '19EE0C', 1, null)).toBe('MaleRough:19EE0C:1');
  });
});

describe('origin fallback of lookups', () => {
  const origin = 'fallout4.esm';

  it('prefers (origin, speaker), then (no origin, speaker), then (no origin, no speaker)', () => {
    const exact = voiceSynthesisStateKey('MaleRough', '19EE0C', 1, origin);
    const noOrigin = voiceSynthesisStateKey('MaleRough', '19EE0C', 1);
    const legacy = voiceSynthesisStateKey('', '19EE0C', 1);

    const all = new Map([
      [exact, 'a'],
      [noOrigin, 'b'],
      [legacy, 'c'],
    ]);
    expect(lookupVoiceSynthesisVersion(all, 'MaleRough', '19EE0C', 1, origin)).toBe('a');
    all.delete(exact);
    expect(lookupVoiceSynthesisVersion(all, 'MaleRough', '19EE0C', 1, origin)).toBe('b');
    all.delete(noOrigin);
    expect(lookupVoiceSynthesisVersion(all, 'MaleRough', '19EE0C', 1, origin)).toBe('c');
    all.delete(legacy);
    expect(lookupVoiceSynthesisVersion(all, 'MaleRough', '19EE0C', 1, origin)).toBeNull();
  });

  it('does not use a stamp stored under a different origin', () => {
    const other = new Map([
      [voiceSynthesisStateKey('MaleRough', '19EE0C', 1, 'dlcrobot.esm'), 'x'],
    ]);
    expect(lookupVoiceSynthesisVersion(other, 'MaleRough', '19EE0C', 1, origin)).toBeNull();
  });

  it('applies the same fallback to similarity scores', () => {
    const map = new Map([[voiceSynthesisStateKey('', '19EE0C', 1), 0.5]]);
    expect(lookupVoiceSimilarity(map, 'MaleRough', '19EE0C', 1, origin)).toBe(0.5);
    map.set(voiceSynthesisStateKey('MaleRough', '19EE0C', 1, origin), 0.9);
    expect(lookupVoiceSimilarity(map, 'MaleRough', '19EE0C', 1, origin)).toBe(0.9);
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

describe('lookupVoiceSimilarity', () => {
  const map = new Map([
    [voiceSynthesisStateKey('PlayerVoiceMale01', '005825', 1), 0.41],
    [voiceSynthesisStateKey('', '00ABCD', 2), 0.22],
  ]);

  it('prefers the per-speaker score', () => {
    expect(lookupVoiceSimilarity(map, 'PlayerVoiceMale01', '005825', 1)).toBe(0.41);
  });

  it('falls back to a legacy row', () => {
    expect(lookupVoiceSimilarity(map, 'PlayerVoiceFemale01', '00ABCD', 2)).toBe(0.22);
  });

  it('is null when nothing was stored', () => {
    expect(lookupVoiceSimilarity(map, 'PlayerVoiceMale01', '00FFFF', 1)).toBeNull();
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
