import type { GameType } from '../../types';

/**
 * File descriptor returned by export endpoints.
 *
 * The HTTP layer typically returns these objects directly as JSON; binary
 * content is represented as base64 to keep the transport simple.
 */
export type ExportedStringsFile = {
  fileName: string;
  size: number;
  contentBase64: string;
};

/** Controls whether patched PEX scripts are included in archive export. */
export type ArchiveExportOptions = {
  includeScripts?: boolean;
};

/**
 * Bulk / CLI release export options.
 *
 * Defaults match the mass-localization script:
 * - strings embedded in the plugin (patched ESP),
 * - scripts exported as loose files under `Scripts\` (not repacked),
 * - no BA2/BSA archive created.
 */
export type ModReleaseExportOptions = {
  /** Export external STRINGS tables instead of patching the ESP. */
  forceLocalized?: boolean;
  /** Pack STRINGS (and optionally scripts) into a BA2/BSA archive. */
  repackArchives?: boolean;
  /** Patch and export compiled Papyrus scripts (default: true). */
  localizeScripts?: boolean;
};

export type ModReleaseExportResult = {
  modId: number;
  modName: string;
  outDir: string;
  files: string[];
  warnings: string[];
};

export type ModExportTarget = {
  modId: number;
  modName: string;
  modPath: string;
  srcLang: string;
  game: GameType;
  isLocalized: boolean;
};

export type ZipPackEntry = {
  name: string;
  data?: Buffer;
  absPath?: string;
};
