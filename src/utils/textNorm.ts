// Simple normalization for hashing/alignment: lowercasing, stripping tags/placeholders/numbers and collapsing whitespace.
import { PLACEHOLDER_RE } from './placeholders.js';

export function normalizeForHash(s: string): string {
  let t = s || '';
  t = t.replace(PLACEHOLDER_RE, '¤PH¤');
  t = t.replace(/\d+/g, '¤NUM¤');
  t = t.replace(/\s+/g, ' ');
  t = t.trim().toLowerCase();
  return t;
}
