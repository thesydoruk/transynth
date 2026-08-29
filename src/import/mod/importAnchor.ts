/**
 * Choose the import anchor for an extracted mod archive.
 *
 * Primary plugins win. Secondary copies under Optional/fomod are ignored so
 * MCM/Interface-only packages (e.g. FallUI Inventory) use a translation txt.
 * Disco Final Cut packs (`.po` language folders) are accepted when neither
 * plugin nor MCM is present.
 */
import { findFirstMcmTranslationFile, hasMcmTranslationFiles } from '../../formats/mcm';
import { findFirstDiscoPoFile, hasDiscoPoPack } from '../../formats/po';
import type { GameType } from '../../types';
import { discoverModFiles, isPluginPath } from './discovery';

/** Path segments that mark optional / installer-only plugin copies. */
const SECONDARY_PLUGIN_DIR_NAMES = new Set([
  'optional',
  'fomod',
  'docs',
  'documentation',
  'readmes',
]);

/** True when a plugin lives under Optional/, fomod/, docs/, etc. */
export const isSecondaryPluginPath = (pluginPath: string): boolean => {
  const parts = pluginPath.replace(/\\/g, '/').split('/');
  return parts.some((part) => SECONDARY_PLUGIN_DIR_NAMES.has(part.toLowerCase()));
};

/** Plugins suitable as the primary import target. */
export const filterPrimaryPlugins = (plugins: string[]): string[] =>
  plugins.filter((plugin) => !isSecondaryPluginPath(plugin));

export type ArchiveImportAnchor = {
  anchorPath: string;
  /** True when the anchor is a Bethesda plugin (.esp/.esm/.esl). */
  isPlugin: boolean;
};

/**
 * Resolve what to store as `mod_imports.esp_path` for an extracted archive.
 *
 * Prefers a primary plugin; otherwise the first MCM Helper translation txt;
 * otherwise a Disco Final Cut `.po` file.
 */
export const selectArchiveImportAnchor = (
  extractDir: string,
  game?: GameType,
): ArchiveImportAnchor => {
  // Disco uploads are Final Cut packs — prefer `.po` before Bethesda heuristics.
  if (game === 'disco' && hasDiscoPoPack(extractDir)) {
    const anchorPath = findFirstDiscoPoFile(extractDir);
    if (anchorPath) return { anchorPath, isPlugin: false };
  }

  const primaryPlugins = filterPrimaryPlugins(discoverModFiles(extractDir).plugins);
  if (primaryPlugins.length > 0) {
    const anchorPath = primaryPlugins[0]!;
    return { anchorPath, isPlugin: isPluginPath(anchorPath) };
  }

  if (hasMcmTranslationFiles(extractDir)) {
    const anchorPath = findFirstMcmTranslationFile(extractDir);
    if (anchorPath) return { anchorPath, isPlugin: false };
  }

  if (hasDiscoPoPack(extractDir)) {
    const anchorPath = findFirstDiscoPoFile(extractDir);
    if (anchorPath) return { anchorPath, isPlugin: false };
  }

  throw new Error(
    'No ESP/ESM/ESL plugin, MCM translation files, or Disco Final Cut .po pack found in archive',
  );
};
