import type { Tx } from '../../../../src/db';
import type { LlmGlossaryEntry } from '../../../../src/llm/translate';
import type { LlmVerifyItem } from '../../../../src/llm/verifyTranslate';
import { resolveGlossaryFixSuggestion as resolveGlossaryFixSuggestionCore } from '../../../../src/llm/glossaryVerify';
import { termWordBoundaryRe } from '../../../../src/web/data/queries';

export type GlossaryEntryWithRe = LlmGlossaryEntry & { re: RegExp };

export const loadGlossaryEntries = async (
  db: Tx,
  srcLang: string,
  targetLang: string,
): Promise<GlossaryEntryWithRe[]> => {
  const { rows } = await db.query<{ term: string; translation: string | null }>(
    `SELECT term, translation FROM glossary WHERE src_lang = $1 AND tgt_lang = $2 ORDER BY term LIMIT 2000`,
    [srcLang, targetLang],
  );
  return rows
    .filter((g) => g.term.trim() !== '')
    .map((g) => ({ ...g, re: termWordBoundaryRe(g.term) }));
};

/** Glossary terms that appear in the given source texts (capped for prompt size). */
export const relevantGlossaryEntries = (
  glossaryAll: GlossaryEntryWithRe[],
  sourceTexts: string[],
  limit = 100,
): LlmGlossaryEntry[] => {
  if (glossaryAll.length === 0) return [];
  const out: LlmGlossaryEntry[] = [];
  for (const g of glossaryAll) {
    if (sourceTexts.some((text) => g.re.test(text))) {
      out.push({ term: g.term, translation: g.translation });
      if (out.length >= limit) break;
    }
  }
  return out;
};

export { findGlossaryViolation } from '../../../../src/llm/glossaryVerify';

export const resolveGlossaryFixSuggestion = (
  item: LlmVerifyItem,
  glossary: LlmGlossaryEntry[],
): string | null => resolveGlossaryFixSuggestionCore(item.source, item.translation, glossary);
