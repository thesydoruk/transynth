import type { Tx } from '../../../db';
import type { LlmGlossaryEntry } from '../../../llm/translate';
import { termWordBoundaryRe } from '../../data/queries';
import type { GlossaryEntryWithRe } from './types';

export const loadGlossaryForBatch = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
): Promise<GlossaryEntryWithRe[]> => {
  const { rows: glossaryRows } = await db.query<{ term: string; translation: string | null }>(
    `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 2000`,
    [srcLang, targetLang],
  );
  return glossaryRows
    .filter((g) => g.term.trim() !== '')
    .map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/**
 * Pick the glossary entries relevant to a chunk: a term is included only when
 * it appears (on word boundaries) in at least one of the chunk's source texts.
 * Capped at 100 entries to bound the prompt size for very large batches.
 */
export const relevantGlossaryForChunk = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
): LlmGlossaryEntry[] => {
  if (glossaryAll.length === 0) return [];
  const out: LlmGlossaryEntry[] = [];
  for (const g of glossaryAll) {
    if (sourceTexts.some((text) => g.re.test(text))) {
      out.push({ term: g.term, translation: g.translation });
      if (out.length >= 100) break;
    }
  }
  return out;
};
