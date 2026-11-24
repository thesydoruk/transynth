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
 * A title whose fonts have no letters of the language at all (Starfield) names donor
 * libraries in its `interfaceFonts`: the missing letters are then added to every font
 * that has a same-design counterpart there, before the config step remaps the rest.
 *
 * Only files the mod itself ships are touched — for a base game imported as a mod, that
 * includes its interface archive. A mod without interface fonts exports as before.
 */
import { DEFAULT_GAME_ID } from '../../games/registry';
import {
  glyphOpsForLanguage,
  patchFontGlyphs,
  readDefineFonts,
  supplyFontGlyphs,
  type DefineFont,
} from '../../formats/swf';
import { exportLocaleSlots, interfaceFontsForGame, isOfficialBethesdaLocale } from '../../locale';
import { log } from '../../logger';
import type { GameId } from '../../types';
import { patchFontConfigForLanguage } from './exportFontConfig';
import { readModInterfaceFile } from './modInterfaceFiles';

export type PatchedFontFile = {
  /** Path inside the mod, e.g. `Interface/fonts_en.swf`. */
  archivePath: string;
  buffer: Buffer;
  /** What changed, for logging. */
  summary: string;
};

/** Fallout 4's layout: one `.swf` library per slot and one shared config. */
const DEFAULT_LIBRARIES = ['fonts_{slot}.swf'];
const DEFAULT_CONFIGS = ['FontConfig.txt'];

const forSlot = (pattern: string, slot: string): string => pattern.replace('{slot}', slot);

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Fonts of the title's donor libraries, read once per export. */
const readDonors = (modPath: string, names: readonly string[]): DefineFont[] =>
  names.flatMap((name) => {
    const library = readModInterfaceFile(modPath, name);
    if (!library) return [];
    try {
      return readDefineFonts(library);
    } catch (err) {
      log.info(`Font export: donor ${name} unreadable (${errorText(err)})`);
      return [];
    }
  });

/** Add missing letters from the donors, then rebuild placeholder glyphs. */
const patchLibrary = (
  source: Buffer,
  targetLang: string,
  donors: DefineFont[],
): { buffer: Buffer; summary: string } | null => {
  const parts: string[] = [];
  let buffer = source;

  if (donors.length > 0) {
    const supplied = supplyFontGlyphs(buffer, donors, targetLang);
    if (supplied.addedCount > 0) {
      buffer = supplied.buffer;
      const fonts = supplied.reports.filter((r) => r.added.length > 0).map((r) => r.font);
      parts.push(`added ${supplied.addedCount} glyph(s) to ${fonts.join(', ')}`);
    }
  }

  const ops = glyphOpsForLanguage(targetLang);
  if (ops.length > 0) {
    const { buffer: repaired, results, appliedCount } = patchFontGlyphs(buffer, ops);
    if (appliedCount > 0) {
      buffer = repaired;
      const rebuilt = [...new Set(results.filter((r) => r.applied).map((r) => r.op.to))];
      parts.push(`rebuilt ${appliedCount} glyph(s): ${rebuilt.join(' ')}`);
    }
  }

  return parts.length > 0 ? { buffer, summary: parts.join('; ') } : null;
};

const patchLibraries = (
  modPath: string,
  targetLang: string,
  game: GameId,
  patterns: readonly string[],
  donors: DefineFont[],
): { files: PatchedFontFile[]; libraries: Map<string, Buffer> } => {
  const files: PatchedFontFile[] = [];
  const libraries = new Map<string, Buffer>();

  for (const slot of exportLocaleSlots(targetLang, game)) {
    for (const pattern of patterns) {
      const fileName = forSlot(pattern, slot);
      const source = readModInterfaceFile(modPath, fileName);
      if (!source) continue;

      libraries.set(fileName.toLowerCase(), source);
      try {
        const patched = patchLibrary(source, targetLang, donors);
        if (!patched) continue;
        libraries.set(fileName.toLowerCase(), patched.buffer);
        files.push({ archivePath: `Interface/${fileName}`, ...patched });
      } catch (err) {
        log.info(`Font export: ${fileName} left as is (${errorText(err)})`);
      }
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
  game: GameId = DEFAULT_GAME_ID,
): PatchedFontFile[] => {
  // Official languages already have fonts drawing their alphabet.
  if (isOfficialBethesdaLocale(targetLang, game)) return [];

  const fonts = interfaceFontsForGame(game);
  const patterns = fonts?.libraries ?? DEFAULT_LIBRARIES;
  const configs = fonts
    ? exportLocaleSlots(targetLang, game).map((slot) => forSlot(fonts.config, slot))
    : DEFAULT_CONFIGS;
  const donors = fonts ? readDonors(modPath, fonts.donorLibraries) : [];

  const { files, libraries } = patchLibraries(modPath, targetLang, game, patterns, donors);

  // A config may name a library without its extension (Starfield: `fontlib "fonts_en"`).
  const readLibrary = (name: string): Buffer | null => {
    const names = /\.[a-z]+$/i.test(name) ? [name] : [`${name}.swf`, `${name}.gfx`];
    for (const candidate of names) {
      const library =
        libraries.get(candidate.toLowerCase()) ?? readModInterfaceFile(modPath, candidate);
      if (library) return library;
    }
    return null;
  };

  for (const configName of configs) {
    const source = readModInterfaceFile(modPath, configName);
    if (!source) continue;

    try {
      // The config also loads libraries of its own, such as the console fonts.
      const patched = patchFontConfigForLanguage(
        source,
        readLibrary,
        targetLang,
        fonts?.fallbackFamilies,
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
      log.info(`Font export: ${configName} left as is (${errorText(err)})`);
    }
  }

  for (const file of files) log.info(`Font export: ${file.archivePath} — ${file.summary}`);

  return files;
};
