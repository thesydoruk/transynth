import { glossaryGameKey } from '../../../games/glossaryKey';
import { allGamePlugins } from '../../../games/registry';

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

/**
 * SQL expression mapping `m.game` to the game whose glossary rows it reads.
 *
 * Built from the registry, so an edition that shares another's term list
 * (Skyrim LE reads Skyrim SE's) is folded in without editing this query. Ids
 * come from registered plugins, never from user input, and are restricted to
 * url-safe characters before they reach the SQL.
 */
export const glossaryModGameSql = (): string => {
  const branches = allGamePlugins()
    .filter((plugin) => plugin.storageKeys.glossary !== plugin.id)
    .filter((plugin) => /^[a-z0-9_-]+$/.test(plugin.id + plugin.storageKeys.glossary))
    .map((plugin) => `WHEN m.game = '${plugin.id}' THEN '${plugin.storageKeys.glossary}'`);
  return branches.length > 0 ? `CASE ${branches.join(' ')} ELSE m.game END` : 'm.game';
};

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
