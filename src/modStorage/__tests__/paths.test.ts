import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { PATHS } from '../../paths';
import {
  modImportExtractDir,
  modImportLocalizeDir,
  modImportPackOutputDir,
  modStorageRoot,
  modUploadedFilePath,
} from '../paths';

describe('modStorage paths', () => {
  it('uses PATHS.modUploads as the storage root', () => {
    expect(modStorageRoot()).toBe(PATHS.modUploads);
  });

  it('builds upload and import paths under the shared root', () => {
    const root = modStorageRoot();
    expect(modUploadedFilePath('My Mod.rar')).toBe(path.join(root, 'My Mod.rar'));
    expect(modImportExtractDir('abc123')).toBe(path.join(root, '_extracted_abc123'));
    expect(modImportLocalizeDir(path.join(root, '_extracted_abc123'))).toBe(
      path.join(root, '_extracted_abc123', 'localize'),
    );
    expect(modImportPackOutputDir(path.join(root, '_extracted_abc123'))).toBe(
      path.join(root, '_output', '_extracted_abc123'),
    );
  });
});
