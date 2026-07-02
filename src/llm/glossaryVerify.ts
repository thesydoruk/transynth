import type { LlmGlossaryEntry } from './translate';
import { glossaryTermMatchesSource } from '../web/data/queries';

export type GlossaryViolation = { term: string; translation: string };

export type GlossaryVerifyContext = {
  grup?: string | null;
  field?: string | null;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Source is exactly the glossary term or "Term - suffix" (mechanical fix applies). */
export const isExactOrDashGlossarySource = (source: string, term: string): boolean => {
  const trimmed = source.trim();
  const normalizedTerm = term.trim();
  if (trimmed.toLowerCase() === normalizedTerm.toLowerCase()) return true;
  return new RegExp(`^${escapeRegExp(normalizedTerm)}\\s*[-–—]\\s*`, 'i').test(trimmed);
};

const isRaceCompoundMorph = (
  source: string,
  term: string,
  ctx?: GlossaryVerifyContext,
): boolean => {
  if (ctx?.grup !== 'RACE') return false;
  const morphField = ctx.field === 'FMRN' || ctx.field === 'MPPN' || ctx.field === 'TTGP';
  return morphField && !isExactOrDashGlossarySource(source, term);
};

/** "Workshop Plus" is a mod brand — do not force generic "Майстерня" on the product name. */
const isWorkshopBrandContext = (source: string, term: string): boolean =>
  term.trim().toLowerCase() === 'workshop' && /\bworkshop\s*plus\b/i.test(source);

/** Accept exact match or inflected forms (each canonical word stem appears in translation). */
export const canonicalPresentInTranslation = (translation: string, canonical: string): boolean => {
  const tgtLower = translation.toLowerCase();
  const canonLower = canonical.toLowerCase();
  if (tgtLower.includes(canonLower)) return true;

  const words = canonLower.split(/\s+/).filter((word) => word.length >= 3);
  if (words.length === 0) return false;

  return words.every((word) => {
    const stem = word.slice(0, Math.min(word.length, 5));
    return tgtLower.includes(stem);
  });
};

/** First glossary term in source whose required translation is missing from the target text. */
export const findGlossaryViolation = (
  source: string,
  translation: string,
  glossary: LlmGlossaryEntry[],
  ctx?: GlossaryVerifyContext,
): GlossaryViolation | null => {
  for (const entry of glossary) {
    const canonical = entry.translation?.trim();
    if (!canonical) continue;
    if (!glossaryTermMatchesSource(source, entry.term)) continue;
    if (isRaceCompoundMorph(source, entry.term, ctx)) continue;
    if (isWorkshopBrandContext(source, entry.term)) continue;
    if (canonicalPresentInTranslation(translation, canonical)) continue;
    return { term: entry.term, translation: canonical };
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
  if (canonicalPresentInTranslation(translation, canonical)) return null;

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
  ctx?: GlossaryVerifyContext,
): string | null => {
  const violation = findGlossaryViolation(source, translation, glossary, ctx);
  if (!violation) return null;
  return buildGlossaryFixSuggestion(source, translation, violation.term, violation.translation);
};
