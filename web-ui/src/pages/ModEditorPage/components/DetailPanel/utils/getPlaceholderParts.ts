export type PlaceholderPart = {
  text: string;
  isPlaceholder: boolean;
};

/** Keep in sync with `src/utils/placeholders.ts` (`PLACEHOLDER_PATTERN_PARTS`). */
const PLACEHOLDER_PATTERN_PARTS = [
  String.raw`(?:\r\n|\r|\n)(?:[ \t]*(?:\r\n|\r|\n))*`,
  String.raw`<font color='#<Global=[^>]+>'>`,
  String.raw`<font color='#<Global=[^>]+>`,
  String.raw`<Token\.[^>]+>`,
  String.raw`<Alias=[^>]+>`,
  String.raw`<Global=[^>]+>`,
  String.raw`<[^>]+>`,
  String.raw`\[(?:Other|Mod|SS2|NoteMisc|Note|Scrap|Valuable|NonHuman|SS2C2|SS|Underwear|HolotapeV|Key|FullOutfit|FullArmor|Vegetables|PerkMag|FO76|IR|Beer|Leaf|SS2C3|Click|CQ|Accept|Password|Activate|Nuka|Hat|pagebreak|SetCustom|Conversion|HolotapeT|Skilled|Gifted|Hi-Tech Farm|Requires Gifted Endurance)\]`,
  String.raw`\[\*[A-Za-z]+\]`,
  String.raw`\[<[^>]+>\]`,
  String.raw`\[[A-Za-z][A-Za-z0-9]*:[0-9A-Fa-f]+\]`,
  String.raw`%%`,
  String.raw`%\d+\.\d+[sdif]`,
  String.raw`%\.\d+[sdif]`,
  String.raw`%\d*\$?[sdif]`,
  String.raw`\{[0-9]+\}`,
  String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
  String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
] as const;

const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_PATTERN_PARTS.join('|'), 'g');

/**
 * Splits text into normal and placeholder segments for inline visual highlighting.
 *
 * The token patterns mirror the backend placeholder protection rules so the editor
 * highlights the same strings that QA validates.
 */
export const getPlaceholderParts = (text: string): PlaceholderPart[] => {
  if (text.length === 0) return [{ text: '', isPlaceholder: false }];

  const parts: PlaceholderPart[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let lastIndex = 0;
  let match = PLACEHOLDER_RE.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isPlaceholder: false });
    }
    parts.push({ text: match[0], isPlaceholder: true });
    lastIndex = match.index + match[0].length;
    match = PLACEHOLDER_RE.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isPlaceholder: false });
  }

  return parts;
};
