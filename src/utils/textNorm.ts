// Simple normalization for hashing/alignment: lowercasing, stripping tags/placeholders/numbers and collapsing whitespace.

const PLACEHOLDER_RE = new RegExp([
  String.raw`%\d*\$?[sdif]`,
  String.raw`\{[0-9]+\}`,
  String.raw`\{[A-Za-z_][A-Za-z0-9_]*\}`,
  String.raw`\[[^\]]+\]`,
  String.raw`<[^>]+>`,
  String.raw`\$[A-Za-z_][A-Za-z0-9_]*`
].join('|'), 'g');

export function normalizeForHash(s: string): string {
  let t = s || '';
  t = t.replace(PLACEHOLDER_RE, '¤PH¤');
  t = t.replace(/\d+/g, '¤NUM¤');
  t = t.replace(/\s+/g, ' ');
  t = t.trim().toLowerCase();
  return t;
}
