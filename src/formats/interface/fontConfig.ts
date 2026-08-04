/**
 * `Interface/FontConfig.txt`: parse and rewrite.
 *
 * The file tells the game which font libraries to load, which family backs each logical
 * font name such as `$Terminal_Font`, and which characters the player is allowed to type
 * into names and books. All three matter for a language the game never shipped: a family
 * may not draw the alphabet at all, and letters missing from the character lists are
 * rejected on input.
 *
 * Lines are kept in place and unknown lines pass through untouched, so a rewritten file
 * differs only where a value changed.
 */

export type FontLibLine = { kind: 'fontlib'; path: string };
export type FontMapLine = { kind: 'map'; name: string; family: string; style: string };
export type CharListLine = { kind: 'chars'; setting: string; chars: string };
export type RawLine = { kind: 'raw'; text: string };

export type FontConfigLine = FontLibLine | FontMapLine | CharListLine | RawLine;

export type FontConfig = {
  lines: FontConfigLine[];
  /** Byte order mark of the source file, preserved on write. */
  bom: boolean;
  /** Line ending of the source file. */
  eol: '\r\n' | '\n';
};

const FONTLIB_RE = /^\s*fontlib\s+"([^"]*)"\s*$/i;
const MAP_RE = /^\s*map\s+"([^"]*)"\s*=\s*"([^"]*)"\s*(\S*)\s*$/i;
const CHARS_RE = /^\s*(validNameChars|validBookChars)\s+"(.*)"\s*$/i;

/**
 * Parse a FontConfig file.
 *
 * @param buffer - Raw file contents; UTF-8, with or without a BOM.
 */
export const parseFontConfig = (buffer: Buffer): FontConfig => {
  const bom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  const lines = text.split(/\r?\n/).map((line): FontConfigLine => {
    const lib = FONTLIB_RE.exec(line);
    if (lib) return { kind: 'fontlib', path: lib[1]! };

    const map = MAP_RE.exec(line);
    if (map) return { kind: 'map', name: map[1]!, family: map[2]!, style: map[3] ?? '' };

    const chars = CHARS_RE.exec(line);
    if (chars) return { kind: 'chars', setting: chars[1]!, chars: chars[2]! };

    return { kind: 'raw', text: line };
  });

  return { lines, bom, eol };
};

const formatLine = (line: FontConfigLine): string => {
  switch (line.kind) {
    case 'fontlib':
      return `fontlib "${line.path}"`;
    case 'map':
      return line.style
        ? `map "${line.name}" = "${line.family}" ${line.style}`
        : `map "${line.name}" = "${line.family}"`;
    case 'chars':
      return `${line.setting} "${line.chars}"`;
    default:
      return line.text;
  }
};

/** Serialise a FontConfig file, keeping its original encoding and line endings. */
export const writeFontConfig = (config: FontConfig): Buffer => {
  const text = config.lines.map(formatLine).join(config.eol);
  return Buffer.from(config.bom ? `\uFEFF${text}` : text, 'utf8');
};

/** File names of the font libraries the config loads, without their folder. */
export const fontConfigLibraryNames = (config: FontConfig): string[] => [
  ...new Set(
    config.lines
      .filter((line): line is FontLibLine => line.kind === 'fontlib')
      .map((line) => line.path.replace(/\\/g, '/').split('/').pop() ?? '')
      .filter(Boolean),
  ),
];

/** Add characters missing from a `validNameChars` / `validBookChars` list. */
export const addAllowedChars = (line: CharListLine, chars: string): string[] => {
  const present = new Set([...line.chars]);
  const added = [...new Set([...chars])].filter((char) => !present.has(char));
  if (added.length > 0) line.chars += added.join('');
  return added;
};
