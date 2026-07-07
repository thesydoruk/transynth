import type { GameType } from '../types';
import { usesBa2Archives } from './bethesdaArchivePaths';

export type Ba2ArchiveRole = 'main' | 'interface' | 'voices' | 'textures' | 'other';

/** Creation Kit string table extensions — always stored uncompressed. */
export const isStringsTablePath = (entryPath: string): boolean => {
  const lower = entryPath.toLowerCase().replace(/\//g, '\\');
  return lower.endsWith('.strings') || lower.endsWith('.dlstrings') || lower.endsWith('.ilstrings');
};

/** DX10 texture archives use a different BA2 layout — never repack from loose files. */
export const isDx10TextureBa2Name = (archiveFileName: string): boolean => {
  const lower = archiveFileName.toLowerCase();
  return lower.includes(' - textures') || lower.includes(' - texture');
};

/** Classify a BA2 archive by Creation Kit naming conventions. */
export const classifyBa2Archive = (archiveFileName: string): Ba2ArchiveRole => {
  const lower = archiveFileName.toLowerCase();
  if (isDx10TextureBa2Name(archiveFileName)) return 'textures';
  if (lower.includes(' - voices') || lower.includes(' - voice')) return 'voices';
  if (lower.includes(' - interface')) return 'interface';
  if (lower.includes(' - main')) return 'main';
  return 'other';
};

/**
 * FO4/FO76 GNRL BA2 (Creation Kit):
 * - Main / Interface / other GNRL: zlib for all files except string tables
 * - Voices: no compression
 * - Textures (DX10): not built here — pass through as-is
 */
export const shouldCompressBa2Entry = (archiveFileName: string, entryPath: string): boolean => {
  if (isStringsTablePath(entryPath)) return false;

  const role = classifyBa2Archive(archiveFileName);
  if (role === 'textures' || role === 'voices') return false;
  return role === 'main' || role === 'interface' || role === 'other';
};

/**
 * BSA (Skyrim / FO3 / FNV — Creation Kit):
 * String tables are uncompressed; all other assets are compressed (zlib v104, LZ4 v105).
 */
export const shouldCompressBsaEntry = (_archiveFileName: string, entryPath: string): boolean => {
  return !isStringsTablePath(entryPath);
};

/** Apply Creation Kit compression rules for the target game and archive file name. */
export const shouldCompressArchiveEntry = (
  archiveType: 'ba2' | 'bsa',
  archiveFileName: string,
  entryPath: string,
  _game: GameType,
): boolean => {
  if (archiveType === 'ba2') return shouldCompressBa2Entry(archiveFileName, entryPath);
  return shouldCompressBsaEntry(archiveFileName, entryPath);
};

/** GNRL BA2 / BSA archives are rebuilt from loose files; DX10 BA2 are copied unchanged. */
export const isRepackableBethesdaArchive = (
  archiveType: 'ba2' | 'bsa',
  archiveFileName: string,
  game: GameType,
): boolean => {
  if (archiveType === 'ba2') {
    if (!usesBa2Archives(game)) return false;
    return !isDx10TextureBa2Name(archiveFileName);
  }
  return !usesBa2Archives(game);
};
