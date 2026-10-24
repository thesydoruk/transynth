import type { Tx } from '../../../../../src/db';
import { nameHintsForGame, selectGlossaryWithNameHints } from '../../../../../src/llm/nameHints';
import type { LlmGlossaryEntry } from '../../../../../src/llm/translate';
import { loadGlossaryTermsForGame, termWordBoundaryRe } from '../../../../../src/web/data/queries';
import type { GlossaryEntryWithRe } from './types';

/** The game's glossary, followed by the name-canon entries it lacks. */
export const loadGlossaryForBatch = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
  game?: string | null,
): Promise<GlossaryEntryWithRe[]> => {
  const glossaryRows = await loadGlossaryTermsForGame(db, srcLang, targetLang, game, {
    limit: 2000,
  });
  const names = nameHintsForGame(game, srcLang, targetLang, glossaryRows);
  return [...glossaryRows, ...names].map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/** Word-boundary hits plus a few embedding neighbors, then names. Never the full glossary. */
export const relevantGlossaryForChunk = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
): Promise<LlmGlossaryEntry[]> => selectGlossaryWithNameHints(glossaryAll, sourceTexts);
