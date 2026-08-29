export type PexLineTextPart = {
  text: string;
  highlight: boolean;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Locate the literal substring inside a `.psc` line (quoted or bare). */
export const findPexLiteralRange = (
  lineText: string,
  literal: string,
): { start: number; end: number } | null => {
  const needle = literal.trim();
  if (!needle) return null;

  for (const quote of ['"', "'"] as const) {
    const pattern = new RegExp(`${quote}\\s*(${escapeRegExp(needle)})\\s*${quote}`);
    const match = pattern.exec(lineText);
    if (match?.[1] != null && match.index != null) {
      const inner = match[1];
      const start = match.index + match[0].indexOf(inner);
      return { start, end: start + inner.length };
    }
  }

  const idx = lineText.indexOf(needle);
  if (idx >= 0) return { start: idx, end: idx + needle.length };
  return null;
};

/** Split a highlighted `.psc` line into plain and literal segments. */
export const splitPexLineForLiteralHighlight = (
  lineText: string,
  literal: string,
  lineHighlighted: boolean,
): PexLineTextPart[] => {
  if (!lineHighlighted) return [{ text: lineText || ' ', highlight: false }];

  const range = findPexLiteralRange(lineText, literal);
  if (!range) return [{ text: lineText || ' ', highlight: false }];

  const parts: PexLineTextPart[] = [];
  if (range.start > 0) parts.push({ text: lineText.slice(0, range.start), highlight: false });
  parts.push({ text: lineText.slice(range.start, range.end), highlight: true });
  if (range.end < lineText.length)
    parts.push({ text: lineText.slice(range.end), highlight: false });
  return parts.length > 0 ? parts : [{ text: lineText || ' ', highlight: false }];
};
