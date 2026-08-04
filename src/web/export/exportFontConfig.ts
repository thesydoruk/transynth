/**
 * Adapt `Interface/FontConfig.txt` to a language the game never shipped.
 *
 * Repairing outlines only helps a family that has the letters to begin with. Fallout 4
 * maps `$HandwrittenFont` to a handwriting face and `$ConsoleFont` to Arial, neither of
 * which carries a single Cyrillic glyph, so those logical fonts have to point at a family
 * that does. The character lists need widening too: letters absent from `validNameChars`
 * are rejected when a player types a name.
 *
 * Every decision is made by looking at the font libraries the config itself loads, so a
 * family is only replaced once it has been shown it cannot draw the alphabet.
 */
import {
  addAllowedChars,
  fontConfigLibraryNames,
  parseFontConfig,
  writeFontConfig,
  type CharListLine,
  type FontMapLine,
} from '../../formats/interface';
import { missingGlyphs, placeholderGlyphs, readSwfFonts, type SwfFont } from '../../formats/swf';
import { languageAlphabet, languageInputChars } from '../../locale';
import { log } from '../../logger';

/** Logical fonts that draw button icons rather than text; their glyphs are not letters. */
const ICON_FONT_RE = /button/i;

/** The logical font the game uses for ordinary interface text. */
const MAIN_FONT_NAME = '$MAIN_Font';

export type FontConfigRemap = { name: string; from: string; to: string };

/** Resolves a font library the config declares, by file name. */
export type FontLibraryResolver = (fileName: string) => Buffer | null;

export type PatchedFontConfig = {
  buffer: Buffer;
  remapped: FontConfigRemap[];
  /** Characters added to the `validNameChars` / `validBookChars` lists. */
  allowedAdded: string[];
};

const canRender = (font: SwfFont, alphabet: string): boolean =>
  !font.cffOnly &&
  missingGlyphs(font, alphabet).length === 0 &&
  placeholderGlyphs(font, alphabet).length === 0;

const matchesFamily = (font: SwfFont, family: string): boolean => {
  const wanted = family.trim().toLowerCase();
  return font.name.toLowerCase() === wanted || font.displayName?.toLowerCase() === wanted;
};

const isBoldName = (name: string): boolean => /bold/i.test(name);

const isMonoName = (name: string): boolean => /mono|consolas|courier/i.test(name);

/**
 * Pick the family to fall back to.
 *
 * Ranked by how little the substitution shows: weight first, then whether the letters
 * still line up in a column as a monospace face's would, then the font the game already
 * uses for ordinary text, and only then sheer coverage.
 */
const pickFallback = (
  candidates: SwfFont[],
  replaced: FontMapLine,
  mainFamily?: string,
): SwfFont | null => {
  const wantBold = isBoldName(replaced.style) || isBoldName(replaced.family);
  const wantMono = isMonoName(replaced.family);

  const score = (font: SwfFont): number =>
    (isBoldName(font.name) === wantBold ? 4 : 0) +
    (isMonoName(font.name) === wantMono ? 3 : 0) +
    (mainFamily && matchesFamily(font, mainFamily) ? 2 : 0);

  const ranked = [...candidates].sort(
    (a, b) => score(b) - score(a) || b.codePoints.size - a.codePoints.size,
  );
  return ranked[0] ?? null;
};

/**
 * Rewrite a FontConfig so every text font can draw the target language.
 *
 * @param source - Original `FontConfig.txt` contents.
 * @param readLibrary - Supplies the libraries the config declares, already repaired where possible.
 * @param targetLang - Language being exported, e.g. `uk`.
 * @returns The patched file, or `null` when nothing needed changing.
 */
export const patchFontConfigForLanguage = (
  source: Buffer,
  readLibrary: FontLibraryResolver,
  targetLang: string,
): PatchedFontConfig | null => {
  const alphabet = languageAlphabet(targetLang);
  if (!alphabet) return null;

  const config = parseFontConfig(source);

  const fonts: SwfFont[] = [];
  for (const name of fontConfigLibraryNames(config)) {
    try {
      const library = readLibrary(name);
      if (library) fonts.push(...readSwfFonts(library));
    } catch (err) {
      log.info(`FontConfig: ${name} unreadable (${err instanceof Error ? err.message : err})`);
    }
  }

  const mapLines = config.lines.filter((line): line is FontMapLine => line.kind === 'map');
  const mainFamily = mapLines.find((line) => line.name === MAIN_FONT_NAME)?.family;
  const usable = fonts.filter((font) => canRender(font, alphabet));

  const remapped: FontConfigRemap[] = [];
  for (const line of mapLines) {
    if (ICON_FONT_RE.test(line.name)) continue;

    const current = fonts.find((font) => matchesFamily(font, line.family));
    // Without the library we cannot tell whether the family is fine; leave it be.
    if (!current || canRender(current, alphabet)) continue;

    const fallback = pickFallback(usable, line, mainFamily);
    if (!fallback || matchesFamily(fallback, line.family)) continue;

    remapped.push({ name: line.name, from: line.family, to: fallback.name });
    line.family = fallback.name;
  }

  const inputChars = languageInputChars(targetLang);
  const allowedAdded = new Set<string>();
  for (const line of config.lines) {
    if (line.kind !== 'chars') continue;
    for (const char of addAllowedChars(line as CharListLine, inputChars)) allowedAdded.add(char);
  }

  if (remapped.length === 0 && allowedAdded.size === 0) return null;

  return { buffer: writeFontConfig(config), remapped, allowedAdded: [...allowedAdded] };
};
