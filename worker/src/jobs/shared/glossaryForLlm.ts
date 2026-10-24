import type { Tx } from '../../../../src/db';
import { nameHintsForGame, selectGlossaryWithNameHints } from '../../../../src/llm/nameHints';
import type { LlmGlossaryEntry } from '../../../../src/llm/translate';

import { loadGlossaryTermsForGame, termWordBoundaryRe } from '../../../../src/web/data/queries';

export type GlossaryEntryWithRe = LlmGlossaryEntry & { re: RegExp };

/** The game's glossary, followed by the name-canon entries it lacks. */
export const loadGlossaryEntries = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
  game?: string | null,
): Promise<GlossaryEntryWithRe[]> => {
  const rows = await loadGlossaryTermsForGame(db, srcLang, targetLang, game, { limit: 2000 });
  const names = nameHintsForGame(game, srcLang, targetLang, rows);
  return [...rows, ...names].map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/** Word-boundary hits plus a few embedding neighbors, then names. Never the full glossary. */
export const relevantGlossaryEntries = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
): Promise<LlmGlossaryEntry[]> => selectGlossaryWithNameHints(glossaryAll, sourceTexts);
