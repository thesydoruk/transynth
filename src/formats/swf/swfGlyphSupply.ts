/**
 * Give a font library the letters of a language its fonts never drew.
 *
 * Starfield's `fonts_en` has no Cyrillic at all, so unlike the placeholder repair in
 * `swfFontPatch` there is nothing to rebuild in place: glyphs have to be added. Each
 * missing letter follows its recipe (`glyphRecipes`): a Latin twin from the font
 * itself where one exists, otherwise the letter from the donor font that is the same
 * design, fitted to the target (`glyphFit`). A font is changed only when every letter
 * of the language can be supplied; one that cannot is left exactly as it was, for the
 * FontConfig step to replace with a family that can.
 */
import { log } from '../../logger';
import {
  parseAlignZones,
  writeAlignZones,
  EMPTY_ZONE_RECORD,
  TAG_DEFINE_FONT_ALIGN_ZONES,
  type AlignZones,
} from './alignZones';
import {
  fontAscent,
  parseDefineFontTag,
  writeDefineFontTag,
  type DefineFont,
} from './defineFontTag';
import { matchDonorFont } from './fontDonor';
import { insertGlyph } from './fontLayout';
import { decodeGlyphShape, shapeBounds } from './glyphShape';
import { buildGlyph, fitContext, type BuiltGlyph } from './glyphBuild';
import { languageGlyphs, type LanguageGlyphs } from './glyphRecipes';
import { parseSwf, writeSwf } from './swfTags';

const TAG_DEFINE_FONT2 = 48;
const TAG_DEFINE_FONT3 = 75;

export type GlyphSupplyReport = {
  font: string;
  /** Donor font the borrowed letters came from. */
  donor?: string;
  /** Characters added, in the order they were built. */
  added: string[];
  /** Letters that could not be supplied; when any are, the font is left untouched. */
  missing: string[];
};

export type GlyphSupplyResult = {
  buffer: Buffer;
  reports: GlyphSupplyReport[];
  /** Glyphs added across all fonts. */
  addedCount: number;
};

/** Every `DefineFont2`/`DefineFont3` font of a library. */
export const readDefineFonts = (library: Buffer): DefineFont[] =>
  parseSwf(library)
    .tags.filter((tag) => tag.code === TAG_DEFINE_FONT2 || tag.code === TAG_DEFINE_FONT3)
    .map((tag) => parseDefineFontTag(tag.body))
    .filter((font): font is DefineFont => font !== null);

const has = (font: DefineFont, char: string): boolean =>
  font.codePoints.includes(char.codePointAt(0)!);

const isLower = (char: string): boolean => char !== char.toUpperCase();

/** A unicase face draws its lowercase with the capitals' outlines, as NB Architekt does. */
const isUnicase = (font: DefineFont): boolean => {
  let same = 0;
  for (let cp = 0x61; cp <= 0x7a; cp++) {
    const lower = font.codePoints.indexOf(cp);
    const upper = font.codePoints.indexOf(cp - 0x20);
    if (lower !== -1 && upper !== -1 && font.shapes[lower]!.equals(font.shapes[upper]!)) same++;
  }
  return same >= 20;
};

/** How high an added glyph may reach: the ascent, or the tallest glyph if that is higher. */
const topLimit = (font: DefineFont): number | undefined => {
  const ascent = fontAscent(font);
  if (ascent === null) return undefined;
  let top = -ascent;
  for (const shape of font.shapes) top = Math.min(top, shapeBounds(decodeGlyphShape(shape)).yMin);
  return top;
};

const cloneFont = (font: DefineFont): DefineFont => ({
  ...font,
  shapes: [...font.shapes],
  codePoints: [...font.codePoints],
  layout: Buffer.from(font.layout),
});

/** Add one glyph, keeping the align-zone table in step with the glyph order. */
const addGlyph = (font: DefineFont, zones: AlignZones | null, char: string, glyph: BuiltGlyph) => {
  const refIndex = font.codePoints.indexOf(glyph.zoneFrom.codePointAt(0)!);
  const record = zones && refIndex !== -1 ? zones.records[refIndex] : undefined;
  const index = insertGlyph(font, {
    codePoint: char.codePointAt(0)!,
    shape: glyph.shape,
    advance: glyph.advance,
    bounds: glyph.bounds,
  });
  zones?.records.splice(index, 0, Buffer.from(record ?? EMPTY_ZONE_RECORD));
};

/**
 * Supply the language's letters to one font.
 *
 * @returns The extended font and zones, or `null` with the letters that could not be
 *   supplied; `added` is empty when the font already draws the language.
 */
const supplyFont = (
  font: DefineFont,
  zones: AlignZones | null,
  donors: DefineFont[],
  glyphs: LanguageGlyphs,
): { font: DefineFont; zones: AlignZones | null; report: GlyphSupplyReport } => {
  const report: GlyphSupplyReport = { font: font.name, added: [], missing: [] };
  if ([...glyphs.letters].every((char) => has(font, char))) return { font, zones, report };

  const donor = matchDonorFont(font, donors);
  if (donor) report.donor = donor.name;
  const work = cloneFont(font);
  const workZones = zones && { ...zones, records: [...zones.records] };
  const unicase = isUnicase(font);
  const context = fitContext(work, donor, topLimit(font));
  const wanted = new Set([...glyphs.letters, ...glyphs.extra]);

  for (const [char, recipes] of Object.entries(glyphs.recipes)) {
    if (!wanted.has(char) || has(work, char)) continue;
    const options =
      unicase && isLower(char) ? [{ kind: 'same' as const, from: char.toUpperCase() }] : recipes;
    let built: BuiltGlyph | null = null;
    for (const recipe of options) {
      built = buildGlyph(context, char, recipe);
      if (built) break;
    }
    if (!built) {
      if (glyphs.letters.includes(char)) report.missing.push(char);
      continue;
    }
    addGlyph(work, workZones, char, built);
    report.added.push(char);
  }

  if (report.missing.length > 0) {
    report.added = [];
    return { font, zones, report };
  }
  return { font: work, zones: workZones, report };
};

/**
 * Add the letters of a language to every font of a library that can take them.
 *
 * @param library - Raw `.swf` or `.gfx` font library.
 * @param donors - Fonts to borrow letters from, e.g. `readDefineFonts(fonts_ja.swf)`.
 * @param lang - Target language, e.g. `uk`.
 * @param skip - Font names to leave alone, such as icon fonts.
 * @returns The rewritten library and a report per font.
 */
export const supplyFontGlyphs = (
  library: Buffer,
  donors: DefineFont[],
  lang: string,
  skip: (name: string) => boolean = () => false,
): GlyphSupplyResult => {
  const glyphs = languageGlyphs(lang);
  if (!glyphs) return { buffer: library, reports: [], addedCount: 0 };

  const swf = parseSwf(library);
  const zoneTags = new Map<number, number>();
  swf.tags.forEach((tag, i) => {
    if (tag.code === TAG_DEFINE_FONT_ALIGN_ZONES && tag.body.length >= 2) {
      zoneTags.set(tag.body.readUInt16LE(0), i);
    }
  });

  const usableDonors = donors.filter(
    (donor) =>
      [...glyphs.letters].filter((char) => has(donor, char)).length * 2 >= glyphs.letters.length,
  );
  const reports: GlyphSupplyReport[] = [];
  let addedCount = 0;

  swf.tags.forEach((tag, i) => {
    if (tag.code !== TAG_DEFINE_FONT2 && tag.code !== TAG_DEFINE_FONT3) return;
    const font = parseDefineFontTag(tag.body);
    if (!font || skip(font.name)) return;

    const zoneIndex = zoneTags.get(font.fontId);
    const zones = zoneIndex === undefined ? null : parseAlignZones(swf.tags[zoneIndex]!.body);
    const result = supplyFont(font, zones, usableDonors, glyphs);
    reports.push(result.report);
    if (result.report.added.length === 0) return;

    swf.tags[i] = { code: tag.code, body: writeDefineFontTag(result.font) };
    if (zoneIndex !== undefined && result.zones) {
      swf.tags[zoneIndex] = {
        code: TAG_DEFINE_FONT_ALIGN_ZONES,
        body: writeAlignZones(result.zones),
      };
    }
    addedCount += result.report.added.length;
    log.info(
      `SWF glyph supply: added ${result.report.added.length} glyph(s) to ${font.name}` +
        (result.report.donor ? ` (donor ${result.report.donor})` : ''),
    );
  });

  return { buffer: addedCount > 0 ? writeSwf(swf) : library, reports, addedCount };
};
