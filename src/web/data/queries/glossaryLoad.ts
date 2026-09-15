import type { Tx } from '../../../db/types';
import { glossaryGameKey } from '../../../games/glossaryKey';
import type { GlossaryQaTerm, GlossaryTermRow } from './glossaryHelpers';

/** Canonical terms for one game + language pair. Never the full cross-game table. */
export const loadGlossaryTermsForGame = async (
  db: Tx,
  srcLang: string,
  tgtLang: string,
  game?: string | null,
  opts?: { limit?: number; requireTranslation?: boolean },
): Promise<GlossaryTermRow[]> => {
  const params: unknown[] = [srcLang, tgtLang, glossaryGameKey(game)];
  const requireTranslation = opts?.requireTranslation === true;
  const limit = opts?.limit;
  const limitSql = limit != null ? ` LIMIT $${params.push(limit)}` : '';
  const { rows } = await db.query<GlossaryTermRow>(
    `SELECT term, translation FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND game = $3
       ${requireTranslation ? 'AND translation IS NOT NULL' : ''}
     ORDER BY term${limitSql}`,
    params,
  );
  return rows.filter((row) => row.term.trim() !== '');
};

/** QA load: every game’s terms, so a mixed-id batch can pick per row. */
export const loadGlossaryTermsForQa = async (
  db: Tx,
  srcLang: string,
  tgtLang: string,
): Promise<GlossaryQaTerm[]> => {
  const { rows } = await db.query<GlossaryQaTerm>(
    `SELECT term, translation, game FROM glossary
     WHERE src_lang = $1 AND tgt_lang = $2 AND translation IS NOT NULL`,
    [srcLang, tgtLang],
  );
  return rows.filter((row) => row.term.trim() !== '');
};
