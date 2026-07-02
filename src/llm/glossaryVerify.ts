import type { LlmGlossaryEntry } from './translate';
import { glossaryTermMatchesSource } from '../web/queries';

export type GlossaryViolation = { term: string; translation: string };

/** First glossary term in source whose required translation is missing from the target text. */
export const findGlossaryViolation = (
  source: string,
  translation: string,
  glossary: LlmGlossaryEntry[],
): GlossaryViolation | null => {
  const tgtLower = translation.toLowerCase();
  for (const entry of glossary) {
    const canonical = entry.translation?.trim();
    if (!canonical) continue;
    if (
      glossaryTermMatchesSource(source, entry.term) &&
      !tgtLower.includes(canonical.toLowerCase())
    ) {
      return { term: entry.term, translation: canonical };
    }
  }
  return null;
};

/** Build a canonical fix from glossary + numbered dash patterns (e.g. "Layer Handle - 4"). */
export const buildGlossaryFixSuggestion = (
  source: string,
  translation: string,
  term: string,
  canonical: string,
): string | null => {
  if (translation.toLowerCase().includes(canonical.toLowerCase())) return null;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dashMatch = source.match(new RegExp(`^${escaped}\\s*-\\s*(.+)$`, 'i'));
  if (dashMatch) {
    const suffix = dashMatch[1].trim();
    const numberMatch = suffix.match(/^(\d+)/);
    if (numberMatch) {
      let suggestion = `${canonical} — ${numberMatch[1]}`;
      const parenInTr = translation.match(/\([^)]+\)\s*$/);
      if (parenInTr) suggestion += ` ${parenInTr[0]}`;
      return suggestion;
    }
    return `${canonical} — ${suffix}`;
  }

  if (source.trim().toLowerCase() === term.toLowerCase()) return canonical;

  return null;
};

export const resolveGlossaryFixSuggestion = (
  source: string,
  translation: string,
  glossary: LlmGlossaryEntry[],
): string | null => {
  const violation = findGlossaryViolation(source, translation, glossary);
  if (!violation) return null;
  return buildGlossaryFixSuggestion(source, translation, violation.term, violation.translation);
};
