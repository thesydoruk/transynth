/**
 * Decoding of text a Creation Engine game stores as bytes: string table entries
 * and strings embedded in a plugin.
 *
 * The files do not say which encoding they use. The English tables of Fallout 4
 * and Starfield are Windows-1252 (`Touch\xE9.`, `Komiko\x92s`), while translated
 * tables and plugins — Ukrainian, Russian, Japanese — are UTF-8. A string is
 * therefore read as UTF-8 when its bytes are valid UTF-8 and as Windows-1252
 * otherwise; plain ASCII is the same in both.
 *
 * The choice is made per string. A string that mixes both encodings is not
 * valid UTF-8 and reads as Windows-1252 as a whole.
 */

const REPLACEMENT_CHARACTER = '�';

// `ignoreBOM` keeps a leading U+FEFF, as `Buffer.toString('utf8')` does.
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * Windows-1252 for bytes 0x80–0x9F, where it differs from Latin-1: typographic
 * quotes, dashes, the ellipsis, `€`, `™`. The five unassigned bytes keep their
 * C1 control code, as the WHATWG encoding does. Node's own `windows-1252`
 * decoder is not used: it reads this whole range as Latin-1 controls.
 */
const WINDOWS_1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ';

const decodeWindows1252 = (buf: Buffer, start: number, end: number): string =>
  buf
    .toString('latin1', start, end)
    .replace(/[\x80-\x9f]/g, (byte) => WINDOWS_1252_HIGH[byte.charCodeAt(0) - 0x80]!);

/**
 * Decode `buf[start, end)` as game text.
 *
 * @returns The text with any NUL terminator still in place.
 */
export const decodeGameText = (buf: Buffer, start = 0, end = buf.length): string => {
  const text = buf.toString('utf8', start, end);
  // No replacement character: every byte was valid UTF-8 (the usual case).
  if (!text.includes(REPLACEMENT_CHARACTER)) return text;
  try {
    // Valid UTF-8 that really contains U+FFFD stays as it is.
    return strictUtf8.decode(buf.subarray(start, end));
  } catch {
    return decodeWindows1252(buf, start, end);
  }
};
