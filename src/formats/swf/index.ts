/**
 * Scaleform/Flash font libraries (`Interface/fonts_*.swf`, and Scaleform's `.gfx`):
 * reading coverage, rebuilding the glyphs a language needs, and adding the ones a
 * font never had.
 */

export type { SwfFile, SwfTag } from './swfTags';

export type { DefineFont } from './defineFontTag';
export { missingGlyphs, placeholderGlyphs, readSwfFonts } from './swfFonts';
export type { PlaceholderGlyph, SwfFont, SwfGlyph } from './swfFonts';
export { glyphOpsForLanguage, patchFontGlyphs } from './swfFontPatch';
export type { FontPatchResult, GlyphOp, GlyphOpResult } from './swfFontPatch';
export { readDefineFonts, supplyFontGlyphs } from './swfGlyphSupply';
export type { GlyphSupplyReport, GlyphSupplyResult } from './swfGlyphSupply';
export { languageGlyphs } from './glyphRecipes';
