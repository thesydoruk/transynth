/**
 * A game's name canon as prompt hints next to the glossary.
 *
 * On the Fallout 4 corpus, machine translation missed the canonical form of a
 * name the source mentioned in 42% of lines when the name was not a glossary
 * term, against 24% when the glossary already put it in the prompt. Names the
 * glossary lacks therefore ride along — but only on a word-boundary hit in the
 * source, never as embedding neighbours (a similar-sounding name is noise, not
 * canon), and never into QA (see {@link GameNameCanon}).
 */
import type { GameNameCanon } from '../games/contract';
import { findGamePlugin } from '../games/registry';
import { selectGlossaryByWordBoundary, selectRelevantGlossary } from './glossarySelect';
import type { LlmGlossaryEntry } from './translate';

/** Names per request, on top of the glossary's own limit. */
export const NAME_HINT_LIMIT = 12;

/** Longer "names" are internal quest descriptions, not something the player reads. */
const MAX_NAME_WORDS = 5;

export type NameHint = LlmGlossaryEntry & { nameHint: true };

const isNameHint = (entry: LlmGlossaryEntry): entry is NameHint =>
  (entry as Partial<NameHint>).nameHint === true;

/** Canon names usable as hints: not already glossary terms, not ordinary words. */
export const nameHintsFromCanon = (
  canon: GameNameCanon,
  glossaryTerms: readonly { term: string }[],
): NameHint[] => {
  const skip = new Set(
    [...glossaryTerms.map((g) => g.term), ...canon.generic].map((t) => t.toLowerCase()),
  );
  return Object.entries(canon.names)
    .filter(([en, uk]) => uk.trim() && en !== uk && !skip.has(en.toLowerCase()))
    .filter(([en]) => en.trim().split(/\s+/).length <= MAX_NAME_WORDS)
    .map(([term, translation]) => ({ term, translation, nameHint: true }));
};

/** Name hints for a game's EN → UK requests; empty for other pairs or games without a canon. */
export const nameHintsForGame = (
  game: string | null | undefined,
  srcLang: string,
  targetLang: string,
  glossaryTerms: readonly { term: string }[],
): NameHint[] => {
  const canon = findGamePlugin(game)?.prompts.nameCanon;
  if (!canon || srcLang !== 'en' || targetLang !== 'uk') return [];
  return nameHintsFromCanon(canon, glossaryTerms);
};

/**
 * Glossary for one request: the usual glossary selection over the terms, then
 * the names the source mentions that the selection did not already carry.
 */
export const selectGlossaryWithNameHints = async (
  entries: readonly LlmGlossaryEntry[],
  sourceTexts: readonly string[],
  selectTerms: typeof selectRelevantGlossary = selectRelevantGlossary,
): Promise<LlmGlossaryEntry[]> => {
  const names = entries.filter(isNameHint);
  const selected = await selectTerms(
    names.length > 0 ? entries.filter((e) => !isNameHint(e)) : entries,
    sourceTexts,
  );
  if (names.length === 0) return selected;
  const used = new Set(selected.map((e) => e.term.toLowerCase()));
  const fresh = names.filter((n) => !used.has(n.term.toLowerCase()));
  return [...selected, ...selectGlossaryByWordBoundary(fresh, sourceTexts, NAME_HINT_LIMIT)];
};
