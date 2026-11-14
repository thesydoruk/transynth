import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { PATHS } from '../../paths';
import {
  isOwnedModStoragePath,
  modImportExtractDir,
  modImportLocalizeDir,
  modImportLocalizeRoot,
  modImportPackOutputDir,
  modImportStorageKey,
  modStorageRoot,
  modUploadedFilePath,
  referenceVoiceRoot,
  referenceVoiceTakePath,
  resolveModImportExtractRoot,
  resolveModImportLocalizeDir,
  resolveModStoredPath,
} from '../paths';

describe('modStorage paths', () => {
  it('uses PATHS.modUploads as the storage root', () => {
    expect(modStorageRoot()).toBe(PATHS.modUploads);
  });

  it('builds upload and import paths under the shared root', () => {
    const root = modStorageRoot();
    const extractRoot = path.join(root, '_extracted_abc123');
    expect(modUploadedFilePath('My Mod.rar')).toBe(path.join(root, 'My Mod.rar'));
    expect(modImportExtractDir('abc123')).toBe(extractRoot);
    expect(modImportStorageKey(extractRoot)).toBe('abc123');
    expect(modImportLocalizeRoot(extractRoot)).toBe(path.join(root, '_localize_abc123'));
    expect(modImportLocalizeDir(extractRoot, 'uk')).toBe(path.join(root, '_localize_abc123', 'uk'));
    expect(modImportPackOutputDir(extractRoot)).toBe(
      path.join(root, '_output', '_extracted_abc123'),
    );
  });

  it('owns only files strictly inside mod storage or Vortex uploads', () => {
    const root = modStorageRoot();
    expect(isOwnedModStoragePath(path.join(root, 'Uploaded.esp'))).toBe(true);
    expect(isOwnedModStoragePath(path.join(PATHS.vortexUploads, '1', 'h', 'A.esp'))).toBe(true);
    expect(isOwnedModStoragePath(root)).toBe(false);
    expect(isOwnedModStoragePath(PATHS.vortexUploads)).toBe(false);
    expect(isOwnedModStoragePath(path.join(root, '..', 'Escaped.esp'))).toBe(false);
    expect(isOwnedModStoragePath(path.resolve('/Games/Skyrim/Data/Skyrim.esm'))).toBe(false);
  });

  it('returns null when localize dir does not exist yet', () => {
    const extractRoot = path.join(modStorageRoot(), '_extracted_missing_test');
    expect(resolveModImportLocalizeDir(extractRoot, 'uk')).toBeNull();
  });

  it('resolves Vortex extract roots so localize overlays are findable', () => {
    const extractRoot = path.join(PATHS.vortexUploads, '1', 'v1_abc123');
    const pluginPath = path.join(extractRoot, 'Data', 'DLCCoast.esm');
    expect(resolveModImportExtractRoot(pluginPath)).toBe(path.resolve(extractRoot));
    expect(modImportLocalizeDir(extractRoot, 'uk')).toBe(
      path.join(modStorageRoot(), `_localize_${modImportStorageKey(extractRoot)}`, 'uk'),
    );
  });

  it('still resolves classic _extracted_ upload trees', () => {
    const extractRoot = path.join(modStorageRoot(), '_extracted_abc123');
    expect(resolveModImportExtractRoot(path.join(extractRoot, 'Fallout4.esm'))).toBe(
      path.resolve(extractRoot),
    );
  });

  it('remaps Windows data paths to the current DATA_DIR', () => {
    const winPath = 'C:\\app\\data\\uploads\\mod\\_extracted_abc\\plugin.esp';
    expect(resolveModStoredPath(winPath)).toBe(
      path.join(PATHS.dataDir, 'uploads', 'mod', '_extracted_abc', 'plugin.esp'),
    );
  });

  describe('reference voice store', () => {
    const key = {
      game: 'fo4',
      lang: 'uk',
      sourceSha1: 'ab' + '0123456789'.repeat(4).slice(0, 38),
      ttsTextVersion: 'f'.repeat(15) + 'e' + '9'.repeat(48),
      fileExt: '.fuz',
    };

    it('addresses a take by game, language, source digest and payload version', () => {
      expect(referenceVoiceRoot()).toBe(path.join(modStorageRoot(), '_reference_voice'));
      expect(referenceVoiceTakePath(key)).toBe(
        path.join(
          modStorageRoot(),
          '_reference_voice',
          'fo4',
          'uk',
          'ab',
          `${key.sourceSha1}-${'f'.repeat(15)}e.fuz`,
        ),
      );
    });

    it('normalizes case, so one take has one path', () => {
      expect(
        referenceVoiceTakePath({
          game: 'FO4',
          lang: ' UK ',
          sourceSha1: key.sourceSha1.toUpperCase(),
          ttsTextVersion: key.ttsTextVersion.toUpperCase(),
          fileExt: '.FUZ',
        }),
      ).toBe(referenceVoiceTakePath(key));
    });

    it('refuses a part that could leave the store', () => {
      expect(() => referenceVoiceTakePath({ ...key, game: '../fo4' })).toThrow(/game/);
      expect(() => referenceVoiceTakePath({ ...key, lang: 'uk/..' })).toThrow(/language/);
      expect(() => referenceVoiceTakePath({ ...key, sourceSha1: 'abc' })).toThrow(/SHA-1/);
      expect(() => referenceVoiceTakePath({ ...key, ttsTextVersion: 'zz' })).toThrow(/version/);
      expect(() => referenceVoiceTakePath({ ...key, fileExt: 'fuz' })).toThrow(/extension/);
      expect(() => referenceVoiceTakePath({ ...key, fileExt: '.fu/z' })).toThrow(/extension/);
    });

    it('is not a mod tree: nothing under it resolves to an extract root', () => {
      expect(resolveModImportExtractRoot(referenceVoiceTakePath(key))).toBeNull();
    });
  });
});
