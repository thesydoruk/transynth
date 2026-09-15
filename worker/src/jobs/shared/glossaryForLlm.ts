import type { Tx } from '../../../../src/db';
import { selectRelevantGlossary } from '../../../../src/llm/glossarySelect';
import type { LlmGlossaryEntry } from '../../../../src/llm/translate';

import { loadGlossaryTermsForGame, termWordBoundaryRe } from '../../../../src/web/data/queries';

export type GlossaryEntryWithRe = LlmGlossaryEntry & { re: RegExp };

export const loadGlossaryEntries = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
  game?: string | null,
): Promise<GlossaryEntryWithRe[]> => {
  const rows = await loadGlossaryTermsForGame(db, srcLang, targetLang, game, { limit: 2000 });
  return rows.map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/** Word-boundary hits plus a few embedding neighbors. Never the full glossary. */
export const relevantGlossaryEntries = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
): Promise<LlmGlossaryEntry[]> => selectRelevantGlossary(glossaryAll, sourceTexts);
