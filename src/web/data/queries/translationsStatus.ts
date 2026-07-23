import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import type { TranslationStatus } from '../statusMachine';

export type ContextMenuTranslationStatus = Exclude<TranslationStatus, 'deleted' | 'skip'>;

export const approveVerifiedTranslations = async (
  db: Tx,
  stringIds: number[],
  targetLang = CONFIG.defaultTgtLang,
): Promise<number> => {
  if (stringIds.length === 0) return 0;
  const { rowCount } = await db.query(
    `UPDATE translations
        SET status = 'reviewed', updated_at = NOW()
      WHERE target_lang = $2
        AND src_string_id = ANY($1::int[])
        AND status IN ('draft', 'tm', 'fuzzy', 'auto')`,
    [stringIds, targetLang],
  );
  return rowCount ?? 0;
};

export const setTranslationsStatus = async (
  db: Tx,
  stringIds: number[],
  status: ContextMenuTranslationStatus,
  targetLang = CONFIG.defaultTgtLang,
): Promise<number> => {
  if (stringIds.length === 0) return 0;

  const provenance =
    status === 'draft' || status === 'reviewed' || status === 'rejected' || status === 'human'
      ? 'human_edit'
      : `${status}_generated`;

  const { rowCount } = await db.query(
    `UPDATE translations t
        SET status = $3,
            provenance = $4,
            updated_at = NOW()
      FROM strings s
      WHERE t.src_string_id = s.id
        AND s.id = ANY($1::int[])
        AND s.is_ignored = FALSE
        AND t.target_lang = $2`,
    [stringIds, targetLang, status, provenance],
  );
  return rowCount ?? 0;
};
