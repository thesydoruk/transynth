export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Build a case-insensitive word-boundary regex for an English glossary term.
 * Uses `\b` anchors so that "iron" won't match inside "environment".
 *
 * @param term - The English glossary term to match.
 * @returns A RegExp that matches the term at word boundaries, case-insensitively.
 */
export const termWordBoundaryRe = (term: string): RegExp =>
  new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');

/** Mixed-case glossary entries are proper nouns; do not match lower-case common words in source. */
export const glossaryTermMatchesSource = (source: string, term: string): boolean => {
  if (/^[A-Z]/.test(term) && term !== term.toUpperCase()) {
    return new RegExp(`\\b${escapeRegExp(term)}\\b`).test(source);
  }
  return termWordBoundaryRe(term).test(source);
};
