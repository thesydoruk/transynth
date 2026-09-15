/**
 * Scaleform/Flash font libraries (`Interface/fonts_*.swf`): reading coverage and
 * rebuilding the glyphs a language needs.
 */

export type { SwfFile, SwfTag } from './swfTags';

export type { DefineFont } from './defineFontTag';
export { missingGlyphs, placeholderGlyphs, readSwfFonts } from './swfFonts';
export type { PlaceholderGlyph, SwfFont, SwfGlyph } from './swfFonts';
export { glyphOpsForLanguage, patchFontGlyphs } from './swfFontPatch';
export type { FontPatchResult, GlyphOp, GlyphOpResult } from './swfFontPatch';
