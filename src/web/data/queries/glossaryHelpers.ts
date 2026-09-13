import { glossaryGameKey } from '../../../llm/prompts/resolveGame';

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

/** SQL: map Skyrim LE mods onto the SSE glossary key. */
export const GLOSSARY_MOD_GAME_SQL = `CASE WHEN m.game = 'sle' THEN 'sse' ELSE m.game END`;

export type GlossaryTermRow = {
  term: string;
  translation: string | null;
};

export type GlossaryQaTerm = {
  term: string;
  translation: string;
  game: string;
};

export const glossaryTermsForGame = (
  terms: readonly GlossaryQaTerm[],
  game?: string | null,
): Array<{ term: string; translation: string }> => {
  const key = glossaryGameKey(game);
  return terms
    .filter((row) => row.game === key)
    .map((row) => ({ term: row.term, translation: row.translation }));
};
