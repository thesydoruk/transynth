import type { Tx } from '../../../../../src/db';
import { selectRelevantGlossary } from '../../../../../src/llm/glossarySelect';
import type { LlmGlossaryEntry } from '../../../../../src/llm/translate';
import { loadGlossaryTermsForGame, termWordBoundaryRe } from '../../../../../src/web/data/queries';
import type { GlossaryEntryWithRe } from './types';

export const loadGlossaryForBatch = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
  game?: string | null,
): Promise<GlossaryEntryWithRe[]> => {
  const glossaryRows = await loadGlossaryTermsForGame(db, srcLang, targetLang, game, {
    limit: 2000,
  });
  return glossaryRows.map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/** Word-boundary hits plus a few embedding neighbors. Never the full glossary. */
export const relevantGlossaryForChunk = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
): Promise<LlmGlossaryEntry[]> => selectRelevantGlossary(glossaryAll, sourceTexts);
