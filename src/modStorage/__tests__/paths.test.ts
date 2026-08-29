import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { PATHS } from '../../paths';
import {
  modImportExtractDir,
  modImportLocalizeDir,
  modImportLocalizeRoot,
  modImportPackOutputDir,
  modImportStorageKey,
  modStorageRoot,
  modUploadedFilePath,
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

  it('returns null when localize dir does not exist yet', () => {
    const extractRoot = path.join(modStorageRoot(), '_extracted_missing_test');
    expect(resolveModImportLocalizeDir(extractRoot, 'uk')).toBeNull();
  });

  it('remaps Windows data paths to the current DATA_DIR', () => {
    const winPath = 'C:\\app\\data\\uploads\\mod\\_extracted_abc\\plugin.esp';
    expect(resolveModStoredPath(winPath)).toBe(
      path.join(PATHS.dataDir, 'uploads', 'mod', '_extracted_abc', 'plugin.esp'),
    );
  });
});
