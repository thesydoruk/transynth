/**
 * Make a mod's own interface fonts usable by a language the game never shipped.
 *
 * Such a language has to borrow someone else's locale slots, and the fonts of those slots
 * only draw the letters their own language needs: Bethesda's terminal font lists
 * «і/ї/є/ґ» but points them at a placeholder box, while its handwriting font and Arial
 * carry no Cyrillic at all. So for every slot the export replaces, the font library gets
 * its glyphs rebuilt, and `FontConfig.txt` is then adapted to what those libraries can
 * actually draw.
 *
 * Only files the mod itself ships are touched. Vanilla game files are left alone, and a
 * mod without interface fonts exports as before.
 */
import { glyphOpsForLanguage, patchFontGlyphs } from '../../formats/swf';
import { exportLocaleSlots, isOfficialBethesdaLocale } from '../../locale';
import { log } from '../../logger';
import type { GameType } from '../../types';
import { patchFontConfigForLanguage } from './exportFontConfig';
import { readModInterfaceFile } from './modInterfaceFiles';

export type PatchedFontFile = {
  /** Path inside the mod, e.g. `Interface/fonts_en.swf`. */
  archivePath: string;
  buffer: Buffer;
  /** What changed, for logging. */
  summary: string;
};

const FONT_CONFIG_NAMES = ['FontConfig.txt'];

const patchLibraries = (
  modPath: string,
  targetLang: string,
  game: GameType,
): { files: PatchedFontFile[]; libraries: Map<string, Buffer> } => {
  const ops = glyphOpsForLanguage(targetLang);
  const files: PatchedFontFile[] = [];
  const libraries = new Map<string, Buffer>();

  for (const slot of exportLocaleSlots(targetLang, game)) {
    const fileName = `fonts_${slot}.swf`;
    const source = readModInterfaceFile(modPath, fileName, game);
    if (!source) continue;

    libraries.set(fileName.toLowerCase(), source);
    if (ops.length === 0) continue;

    try {
      const { buffer, results, appliedCount } = patchFontGlyphs(source, ops);
      if (appliedCount === 0) continue;

      libraries.set(fileName.toLowerCase(), buffer);
      const repaired = [...new Set(results.filter((r) => r.applied).map((r) => r.op.to))];
      files.push({
        archivePath: `Interface/${fileName}`,
        buffer,
        summary: `rebuilt ${appliedCount} glyph(s): ${repaired.join(' ')}`,
      });
    } catch (err) {
      log.info(
        `Font export: ${fileName} left as is (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  return { files, libraries };
};

/**
 * Rebuild the interface font files of every locale slot the target language replaces.
 *
 * @param modPath - Path to the mod's plugin file.
 * @param targetLang - Language being exported, e.g. `uk`.
 * @param game - Game the mod targets.
 * @returns One entry per patched file; empty when nothing needed or could be fixed.
 */
export const exportPatchedFontFiles = (
  modPath: string,
  targetLang: string,
  game: GameType = 'fo4',
): PatchedFontFile[] => {
  // Official languages already have fonts drawing their alphabet.
  if (isOfficialBethesdaLocale(targetLang, game)) return [];

  const { files, libraries } = patchLibraries(modPath, targetLang, game);

  for (const configName of FONT_CONFIG_NAMES) {
    const source = readModInterfaceFile(modPath, configName, game);
    if (!source) continue;

    try {
      // The config also loads libraries of its own, such as the console fonts.
      const patched = patchFontConfigForLanguage(
        source,
        (name) => libraries.get(name.toLowerCase()) ?? readModInterfaceFile(modPath, name, game),
        targetLang,
      );
      if (!patched) continue;

      const remaps = patched.remapped.map((r) => `${r.name}: ${r.from} → ${r.to}`);
      files.push({
        archivePath: `Interface/${configName}`,
        buffer: patched.buffer,
        summary: [
          remaps.length > 0 ? `remapped ${remaps.join(', ')}` : '',
          patched.allowedAdded.length > 0 ? `allowed ${patched.allowedAdded.length} char(s)` : '',
        ]
          .filter(Boolean)
          .join('; '),
      });
    } catch (err) {
      log.info(
        `Font export: ${configName} left as is (${err instanceof Error ? err.message : String(err)})`,
      );
    }
  }

  for (const file of files) log.info(`Font export: ${file.archivePath} — ${file.summary}`);

  return files;
};
