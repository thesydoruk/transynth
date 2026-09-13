import {
  normalizeVoiceSourceRelPath,
  storedVoiceSourceHashIfFresh,
  takeStoredVoiceSourceHash,
  voiceSourceHashMapKey,
} from '../voiceSourceFileHashes';

describe('normalizeVoiceSourceRelPath', () => {
  it('uses forward slashes and lowercases the key', () => {
    expect(normalizeVoiceSourceRelPath('Sound\\Voice\\Mod.esp\\MaleBoston\\00011111_1.fuz')).toBe(
      'sound/voice/mod.esp/maleboston/00011111_1.fuz',
    );
  });
});

describe('voiceSourceHashMapKey', () => {
  it('scopes the path to a mod', () => {
    expect(voiceSourceHashMapKey(9, 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz')).toBe(
      '9:sound/voice/mod.esp/maleboston/00011111_1.fuz',
    );
  });
});

describe('storedVoiceSourceHashIfFresh', () => {
  const stored = { sha1: 'abc', fileSize: 1200, mtimeMs: 1_700_000_000_000 };

  it('returns the digest when size and mtime still match', () => {
    expect(storedVoiceSourceHashIfFresh(stored, 1200, 1_700_000_000_000)).toBe('abc');
  });

  it('misses when the file was replaced or resized', () => {
    expect(storedVoiceSourceHashIfFresh(stored, 1201, 1_700_000_000_000)).toBeNull();
    expect(storedVoiceSourceHashIfFresh(stored, 1200, 1_700_000_000_001)).toBeNull();
    expect(storedVoiceSourceHashIfFresh(undefined, 1200, 1_700_000_000_000)).toBeNull();
  });
});

describe('takeStoredVoiceSourceHash', () => {
  const stored = { sha1: 'abc', fileSize: 1200, mtimeMs: 1 };

  it('returns the digest without statting when trustStored is set', () => {
    expect(takeStoredVoiceSourceHash(stored, { trustStored: true })).toBe('abc');
    expect(takeStoredVoiceSourceHash(undefined, { trustStored: true })).toBeNull();
  });

  it('still requires a size+mtime hit when not trusting the row', () => {
    expect(takeStoredVoiceSourceHash(stored, { fileSize: 1200, mtimeMs: 2 })).toBeNull();
    expect(takeStoredVoiceSourceHash(stored, { fileSize: 1200, mtimeMs: 1 })).toBe('abc');
  });
});
