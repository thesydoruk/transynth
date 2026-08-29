import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { resolveCoherenceGroup } from './coherence';

/**
 * Auto-resolves all coherence inconsistencies for a target language by
 * applying the plurality-winner translation to every inconsistent group.
 *
 * Winner selection per group:
 * 1. Usage count — the translation currently used by the most strings wins.
 * 2. Status quality — human > reviewed > tm > fuzzy > auto > draft, as a tie-breaker.
 * 3. Alphabetical order — for determinism when count and quality are tied.
 */
export const resolveAllCoherenceGroups = async (
  db: Tx,
  targetLang: string,
  srcLang = CONFIG.defaultSrcLang,
  game?: string,
): Promise<{ resolved: number; updated: number }> => {
  const statusWeight = `CASE status WHEN 'human' THEN 6 WHEN 'reviewed' THEN 5 WHEN 'tm' THEN 4 WHEN 'fuzzy' THEN 3 WHEN 'auto' THEN 2 ELSE 1 END`;

  const { rows: winners } = await db.query<{
    source_text: string;
    signature: string;
    translation: string;
  }>(
    `WITH bt AS (
       SELECT
         src_string_id,
         text                  AS translation,
         ${statusWeight}       AS quality
       FROM translations
       WHERE target_lang = $1
     ),
     group_variants AS (
       SELECT s.text_raw                    AS source_text,
              COALESCE(r.signature, '')     AS signature,
              bt.translation,
              COUNT(*)::int                 AS usage_count,
              MAX(bt.quality)::int          AS best_quality
       FROM strings s
       JOIN bt ON bt.src_string_id = s.id
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       WHERE s.lang = $2
         AND s.text_raw <> ''
         AND ($3::text IS NULL OR m.game = $3)
       GROUP BY s.text_raw, COALESCE(r.signature, ''), bt.translation
     ),
     conflicted AS (
       SELECT source_text, signature
       FROM group_variants
       GROUP BY source_text, signature
       HAVING COUNT(DISTINCT translation) > 1
     ),
     page_winners AS (
       SELECT DISTINCT ON (gv.source_text, gv.signature)
         gv.source_text,
         gv.signature,
         gv.translation
       FROM group_variants gv
       JOIN conflicted c
         ON c.source_text = gv.source_text AND c.signature = gv.signature
       ORDER BY gv.source_text, gv.signature, gv.usage_count DESC, gv.best_quality DESC, gv.translation
     )
     SELECT source_text, signature, translation FROM page_winners`,
    [targetLang, srcLang, game ?? null],
  );

  let totalUpdated = 0;
  for (const winner of winners) {
    const result = await resolveCoherenceGroup(
      db,
      winner.source_text,
      winner.signature,
      targetLang,
      winner.translation,
      srcLang,
      game,
    );
    totalUpdated += result.updated;
  }
  log.info(
    `resolve-all coherence: targetLang=${targetLang} game=${game ?? 'all'} resolved=${winners.length} updated=${totalUpdated}`,
  );
  return { resolved: winners.length, updated: totalUpdated };
};
