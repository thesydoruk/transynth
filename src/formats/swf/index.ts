/**
 * Scaleform/Flash font libraries (`Interface/fonts_*.swf`): reading coverage and
 * rebuilding the glyphs a language needs.
 */
export { parseSwf, writeSwf } from './swfTags';
export type { SwfFile, SwfTag } from './swfTags';
export {
  fontAscent,
  glyphAdvance,
  parseDefineFontTag,
  setGlyphAdvance,
  writeDefineFontTag,
} from './defineFontTag';
export type { DefineFont } from './defineFontTag';
export {
  codePointsOf,
  missingGlyphs,
  placeholderGlyphs,
  readSwfFonts,
  PLACEHOLDER_MIN_SHARED,
} from './swfFonts';
export type { PlaceholderGlyph, SwfFont, SwfGlyph } from './swfFonts';
export { glyphOpsForLanguage, patchFontGlyphs, UKRAINIAN_GLYPH_OPS } from './swfFontPatch';
export type { FontPatchResult, GlyphOp, GlyphOpResult } from './swfFontPatch';
