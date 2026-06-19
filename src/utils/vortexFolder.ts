/**
 * Parse Vortex Mod Manager staging folder names into Nexus mod metadata.
 *
 * Typical pattern:
 *   `{Mod Name}-{nexusModId}-{fileId}-{version}-{unixTimestamp}`
 * Examples from Vortex FO4 staging:
 *   `FallUI - Inventory-48758-2-2-1-1666954336`
 *   `A Forest - True Grass-62073-1-1657445287`
 *   `Longer Power Lines 3x-2241-1-1`
 */

import path from 'node:path';

export interface VortexFolderInfo {
  /** Original folder segment as seen on disk. */
  folderName: string;
  /** Human-readable mod title extracted from the folder name. */
  modName: string;
  /** NexusMods numeric mod ID. */
  nexusModId: number;
}

/** Strip optional Vortex installation timestamp suffix (`-1692860656`). */
const stripVortexTimestamp = (folderName: string): string => {
  return folderName.replace(/-(\d{10})$/, '');
};

/**
 * Parse a single path segment (folder name) produced by Vortex.
 * Returns null when the name does not follow the Vortex/Nexus pattern.
 */
export const parseVortexModFolder = (folderName: string): VortexFolderInfo | null => {
  const trimmed = folderName.trim();
  if (!trimmed) return null;

  const rest = stripVortexTimestamp(trimmed);

  // Non-greedy mod name — first `-{modId}-{fileId}` pair after the title.
  const match = rest.match(/^(.+?)-(\d{1,9})-(\d{1,9})(?:-([\d\w.]+(?:-[\d\w.]+)*))?$/i);
  if (match) {
    const nexusModId = Number.parseInt(match[2], 10);
    if (Number.isFinite(nexusModId) && nexusModId > 0) {
      return {
        folderName: trimmed,
        modName: match[1].trim(),
        nexusModId,
      };
    }
  }

  return null;
};

/**
 * Resolve Vortex metadata from the first folder segment under a scan root.
 * For `\\nas\\Vortex Mods\\fallout4\\FallUI - Inventory-48758-...\\Data\\mod.esp`
 * the segment `FallUI - Inventory-48758-...` is parsed.
 */
export const resolveVortexFolderFromPath = (
  filePath: string,
  scanRoot: string,
): VortexFolderInfo | null => {
  const rel = path.relative(scanRoot, filePath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const firstSeg = rel.split(/[/\\]/)[0];
  if (!firstSeg) return null;
  return parseVortexModFolder(firstSeg);
};
