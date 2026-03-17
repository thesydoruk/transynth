export type PlaceholderPart = {
  text: string;
  isPlaceholder: boolean;
};

const PLACEHOLDER_RE = new RegExp(
  [
    String.raw`%\d*\$?[sdif]`,
    String.raw`\{[0-9]+\}`,
    String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
    String.raw`\[[^\]]+\]`,
    String.raw`<[^>]+>`,
    String.raw`\$[A-Za-z_][A-Za-z0-9_]*`,
  ].join('|'),
  'g',
);

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