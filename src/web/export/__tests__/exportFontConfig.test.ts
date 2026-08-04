import { describe, it, expect } from '@jest/globals';
import { fontLibrary } from '../../../formats/swf/__tests__/swfFixtures';
import { languageAlphabet } from '../../../locale';
import { patchFontConfigForLanguage } from '../exportFontConfig';

const LATIN = 'abcABC';
const UKRAINIAN = languageAlphabet('uk');

/** Roboto covers Ukrainian; the handwriting, sign and icon fonts are Latin only. */
const LIBRARY = fontLibrary([
  { name: 'Roboto Condensed', chars: LATIN + UKRAINIAN },
  { name: 'Roboto Condensed Bold', chars: LATIN + UKRAINIAN },
  { name: 'Handwritten_Institute', chars: LATIN },
  { name: 'Brody', chars: LATIN },
  { name: 'Controller  Buttons', chars: LATIN },
]);

const config = (...lines: string[]): Buffer =>
  Buffer.from(['fontlib "Interface\\fonts_en.swf"', ...lines].join('\r\n'), 'utf8');

const patch = (...lines: string[]) =>
  patchFontConfigForLanguage(config(...lines), () => LIBRARY, 'uk');

const mapping = (text: string, name: string): string =>
  text.split(/\r?\n/).find((line) => line.includes(`"${name}"`)) ?? '';

describe('patchFontConfigForLanguage', () => {
  it('points a font that cannot draw the language at one that can', () => {
    const result = patch(
      'map "$MAIN_Font" = "Roboto Condensed" Normal',
      'map "$HandwrittenFont" = "Handwritten_Institute" Normal',
    );

    expect(mapping(result!.buffer.toString('utf8'), '$HandwrittenFont')).toBe(
      'map "$HandwrittenFont" = "Roboto Condensed" Normal',
    );
    expect(result!.remapped).toEqual([
      { name: '$HandwrittenFont', from: 'Handwritten_Institute', to: 'Roboto Condensed' },
    ]);
  });

  it('keeps the weight when it replaces a bold font', () => {
    const result = patch(
      'map "$MAIN_Font" = "Roboto Condensed" Normal',
      'map "$BRODY" = "Brody" Bold',
    );

    expect(mapping(result!.buffer.toString('utf8'), '$BRODY')).toBe(
      'map "$BRODY" = "Roboto Condensed Bold" Bold',
    );
  });

  it('keeps a monospace font monospace', () => {
    const withMono = fontLibrary([
      { name: 'Roboto Condensed', chars: LATIN + UKRAINIAN },
      { name: 'Share-TechMono Regular', chars: LATIN + UKRAINIAN },
      { name: 'Consolas', chars: LATIN },
    ]);

    const result = patchFontConfigForLanguage(
      config(
        'map "$MAIN_Font" = "Roboto Condensed" Normal',
        'map "$DebugTextFont" = "Consolas" Normal',
      ),
      () => withMono,
      'uk',
    );

    expect(mapping(result!.buffer.toString('utf8'), '$DebugTextFont')).toBe(
      'map "$DebugTextFont" = "Share-TechMono Regular" Normal',
    );
  });

  it('leaves a font that already draws the language alone', () => {
    const result = patch('map "$MAIN_Font" = "Roboto Condensed" Normal', 'validNameChars "abc"');

    expect(result!.remapped).toEqual([]);
  });

  it('never touches the button icon fonts', () => {
    const result = patch(
      'map "$MAIN_Font" = "Roboto Condensed" Normal',
      'map "$Controller_Buttons" = "Controller  Buttons" Normal',
      'map "$Controller_Buttons_inverted" = "Controller  Buttons" Normal',
    );

    expect(result).toBeNull();
  });

  it('leaves a family alone when no library proves it lacking', () => {
    const result = patchFontConfigForLanguage(
      config('map "$Papier_font" = "B_52" Normal'),
      () => null,
      'uk',
    );

    expect(result).toBeNull();
  });

  it('makes no choice it cannot back up with a usable family', () => {
    const latinOnly = fontLibrary([{ name: 'Brody', chars: LATIN }]);

    const result = patchFontConfigForLanguage(
      config('map "$BRODY" = "Brody" Normal'),
      () => latinOnly,
      'uk',
    );

    expect(result).toBeNull();
  });

  it("adds the language's letters to the characters a player may type", () => {
    const result = patch('validNameChars "abcБГД"', 'validBookChars "abc"');

    const text = result!.buffer.toString('utf8');
    expect(text).toContain('validNameChars "abcБГДабвгґ');
    expect(text).toContain('validBookChars "abcабвгґ');
    // The whole alphabet plus the apostrophe Ukrainian spelling needs.
    expect(result!.allowedAdded).toHaveLength(UKRAINIAN.length + 1);
    // Letters the list already had are not repeated.
    const nameList = text.split('\r\n').find((line) => line.startsWith('validNameChars'))!;
    expect(nameList.match(/Б/g)).toHaveLength(1);
  });

  it('keeps every other line, its order and the line endings', () => {
    const result = patch(
      '// a comment',
      'map "$HandwrittenFont" = "Handwritten_Institute" Normal',
      'unknownSetting "keep me"',
    );

    expect(result!.buffer.toString('utf8').split('\r\n')).toEqual([
      'fontlib "Interface\\fonts_en.swf"',
      '// a comment',
      'map "$HandwrittenFont" = "Roboto Condensed" Normal',
      'unknownSetting "keep me"',
    ]);
  });

  it('keeps a byte order mark', () => {
    const source = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      config('map "$HandwrittenFont" = "Handwritten_Institute" Normal'),
    ]);

    const result = patchFontConfigForLanguage(source, () => LIBRARY, 'uk');

    expect(result!.buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('does nothing for a language it knows no alphabet for', () => {
    expect(
      patchFontConfigForLanguage(config('validNameChars "abc"'), () => LIBRARY, 'kk'),
    ).toBeNull();
  });
});
