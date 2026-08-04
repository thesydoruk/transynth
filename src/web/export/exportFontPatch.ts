/**
 * Repair the glyphs of a mod's own font libraries on export.
 *
 * A language the game never shipped has to borrow someone else's locale slots, and the
 * fonts of those slots only draw the letters their own language needs: Bethesda's
 * terminal font lists «і/ї/є/ґ» but points them at a placeholder box. So when the
 * target language is unofficial, every font library belonging to a slot the export
 * replaces is rebuilt to draw its letters.
 *
 * Only libraries the mod itself ships are touched. Vanilla game files are left alone,
 * and a mod without fonts simply exports as before.
 */
import { log } from '../../logger';
import { exportLocaleSlots, isOfficialBethesdaLocale } from '../../locale';
import { glyphOpsForLanguage, patchFontGlyphs } from '../../formats/swf/swfFontPatch';
import type { GameType } from '../../types';
import { readModInterfaceFile } from './modInterfaceFiles';

export type PatchedFontLibrary = {
  /** Path inside the mod, e.g. `Interface/fonts_en.swf`. */
  archivePath: string;
  buffer: Buffer;
  /** Letters that were rebuilt, for logging. */
  repaired: string[];
};

/**
 * Rebuild the target language's letters in the font libraries of replaced locales.
 *
 * @param modPath - Path to the mod's plugin file.
 * @param targetLang - Language being exported, e.g. `uk`.
 * @param game - Game the mod targets.
 * @returns One entry per patched library; empty when nothing needed or could be fixed.
 */
export const exportPatchedFontLibraries = (
  modPath: string,
  targetLang: string,
  game: GameType = 'fo4',
): PatchedFontLibrary[] => {
  // Official languages already have fonts drawing their alphabet.
  if (isOfficialBethesdaLocale(targetLang, game)) return [];

  const ops = glyphOpsForLanguage(targetLang);
  if (ops.length === 0) return [];

  const patched: PatchedFontLibrary[] = [];

  for (const slot of exportLocaleSlots(targetLang, game)) {
    const fileName = `fonts_${slot}.swf`;
    const archivePath = `Interface/${fileName}`;

    try {
      const source = readModInterfaceFile(modPath, fileName, game);
      if (!source) continue;

      const { buffer, results, appliedCount } = patchFontGlyphs(source, ops);
      if (appliedCount === 0) {
        log.info(`Font export: nothing to repair in ${fileName}`);
        continue;
      }

      const repaired = [...new Set(results.filter((r) => r.applied).map((r) => r.op.to))];
      patched.push({ archivePath, buffer, repaired });
      log.info(
        `Font export: repaired ${appliedCount} glyph(s) in ${fileName} (${repaired.join(' ')})`,
      );
    } catch (err) {
      log.info(
        `Font export: ${fileName} skipped (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  return patched;
};
