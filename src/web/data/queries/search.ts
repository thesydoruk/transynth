import type { Tx } from '../../../db';
import type pg from 'pg';
import { withTransaction } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import type { TranslationStatus } from '../statusMachine';
import { recordTranslationRevision } from '../translationRevisions';
import { refreshQAIssues } from './qaIssues';

// ── Bulk search-replace ───────────────────────────────────────────────────────

export type SearchReplaceMatch = {
  translationId: number;
  stringId: number;
  formid_hex: string;
  path: string;
  originalText: string;
  newText: string;
};

export const searchReplaceTranslations = async (
  db: Tx,
  modId: number,
  search: string,
  replace: string,
  isRegex: boolean,
  targetLang: string,
  dryRun: boolean,
  srcLang = CONFIG.defaultSrcLang,
): Promise<{ matches: SearchReplaceMatch[]; applied: number }> => {
  const { rows } = await db.query(
    `SELECT t.id AS translation_id, t.text, t.src_string_id AS string_id,
            r.formid_hex, r.path
     FROM translations t
     JOIN strings s ON s.id = t.src_string_id AND s.lang = $3
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1 AND t.target_lang = $2`,
    [modId, targetLang, srcLang],
  );

  const matches: SearchReplaceMatch[] = [];

  // Validate regex before applying to any row
  let pattern: RegExp | null = null;
  if (isRegex) {
    try {
      pattern = new RegExp(search, 'g');
    } catch {
      throw new Error(`Invalid regular expression: ${search}`);
    }
  }

  for (const row of rows) {
    let newText: string;
    if (isRegex && pattern) {
      pattern.lastIndex = 0;
      newText = row.text.replace(pattern, replace);
    } else {
      newText = row.text.split(search).join(replace);
    }

    if (newText !== row.text) {
      matches.push({
        translationId: row.translation_id,
        stringId: row.string_id,
        formid_hex: row.formid_hex,
        path: row.path,
        originalText: row.text,
        newText,
      });
    }
  }

  if (!dryRun && matches.length > 0) {
    log.info(`search-replace: applying ${matches.length} changes`);
    await withTransaction(db as pg.Pool, async (client) => {
      for (const m of matches) {
        await client.query(`UPDATE translations SET text = $1, updated_at = NOW() WHERE id = $2`, [
          m.newText,
          m.translationId,
        ]);
        const { rows: updatedRows } = await client.query(
          `SELECT src_string_id, target_lang, status, provenance, model
           FROM translations WHERE id = $1`,
          [m.translationId],
        );
        const updated = updatedRows[0] as
          | {
              src_string_id: number;
              target_lang: string;
              status: TranslationStatus;
              provenance: string | null;
              model: string | null;
            }
          | undefined;
        if (!updated) continue;
        await recordTranslationRevision(client, {
          stringId: updated.src_string_id,
          translationId: m.translationId,
          targetLang: updated.target_lang,
          text: m.newText,
          status: updated.status,
          provenance: updated.provenance,
          model: updated.model,
          note: 'search_replace',
        });
        await refreshQAIssues(client, updated.src_string_id, updated.target_lang);
      }
    });
  }

  return { matches, applied: dryRun ? 0 : matches.length };
};
