import type { Tx } from '../../db';
import type { GameType } from '../../types';
import { patchStringsMap } from '../../formats/esp';
import { writeStringsBuffer } from '../../formats/strings';
import { exportLocaleSlots } from '../../locale/exportSlots';
import type { ExportedStringsFile } from './exportTypes';
import { loadSourceStringsFiles } from './sourceStringsLoader';
import { getTranslationOverlaysByType } from './translationOverlay';

/**
 * Export translated strings tables for a localized mod (external STRINGS).
 *
 * The export:
 * - loads the source strings tables for `srcLang` from the mod distribution,
 * - builds a translation overlay from the DB,
 * - applies the overlay with source fallback,
 * - and serialises each table to the correct binary format.
 *
 * @param db - Database handle.
 * @param modId - Mod id whose translations should be exported.
 * @param modPath - Absolute path to the imported plugin file (used to find archives).
 * @param srcLang - Source locale suffix (e.g. `"en"`).
 * @param targetLang - Target locale suffix (e.g. `"uk"`).
 * @param game - Target game type (controls archive probing rules).
 * @returns List of exported strings files encoded as base64 payloads.
 */
export const exportLocalizedStringsFiles = async (
  db: Tx,
  modId: number,
  modPath: string,
  srcLang: string,
  targetLang: string,
  game: GameType = 'fo4',
): Promise<ExportedStringsFile[]> => {
  const sourceFiles = loadSourceStringsFiles(modPath, srcLang, game);
  if (sourceFiles.length === 0) {
    throw new Error(`No source .STRINGS files found for locale ${srcLang}`);
  }

  const overlays = await getTranslationOverlaysByType(db, modId, srcLang, targetLang, game);
  if ([...overlays.values()].every((map) => map.size === 0)) {
    throw new Error(`No localized string IDs found for mod ${modId} and locale ${srcLang}`);
  }

  const slots = exportLocaleSlots(targetLang, game);
  const exported: ExportedStringsFile[] = [];

  for (const sourceFile of sourceFiles) {
    const overlay = overlays.get(sourceFile.type) ?? new Map();
    const patched = patchStringsMap(sourceFile.sourceMap, overlay);
    const buf = writeStringsBuffer(patched, sourceFile.type);
    for (const slot of slots) {
      exported.push({
        fileName: `${sourceFile.nameStem}_${slot}.${sourceFile.type}`,
        size: buf.length,
        contentBase64: buf.toString('base64'),
      });
    }
  }

  return exported;
};
