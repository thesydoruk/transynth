import type { Tx } from '../../../db';
import { CONFIG } from '../../../config';
import { APPROVED_STATUS_SQL } from '../../services/modLangStats';

// ── Mods ─────────────────────────────────────────────────────────────────────

/**
 * List mods with aggregate translation statistics.
 * @param db        - database connection / transaction
 * @param opts.game       - optional game filter (e.g. 'fo4'); when omitted returns all games
 * @param opts.srcLang    - source language for string counts
 * @param opts.targetLang - target language for translation counts
 */
export const listMods = async (
  db: Tx,
  opts: { game?: string; srcLang?: string; targetLang?: string } = {},
) => {
  const srcLang = opts.srcLang ?? CONFIG.defaultSrcLang;
  const targetLang = opts.targetLang ?? CONFIG.defaultTgtLang;

  const whereClause = opts.game ? 'WHERE m.game = $3' : '';
  const params: unknown[] = [srcLang, targetLang];
  if (opts.game) params.push(opts.game);

  const queryMods = () =>
    db.query<{
      id: number;
      name: string;
      abs_path: string;
      version_hash: string;
      game: string;
      nexus_mod_id: number | null;
      nexus_name: string | null;
      nexus_thumbnail: string | null;
      created_at: Date;
      record_count: string;
      string_count: string;
      translated_count: string;
      approved_count: string;
      fuzzy_count: string;
    }>(
      `SELECT
        m.id,
        m.name,
        m.abs_path,
        m.version_hash,
        m.game,
        m.nexus_mod_id,
        m.nexus_name,
        m.nexus_thumbnail,
        m.created_at,
        COALESCE(st.record_count, 0)::bigint AS record_count,
        COALESCE(st.string_count, 0)::bigint AS string_count,
        COALESCE(st.translated_count, 0)::bigint AS translated_count,
        COALESCE(st.approved_count, 0)::bigint AS approved_count,
        COALESCE(st.fuzzy_count, 0)::bigint AS fuzzy_count
       FROM mods m
       LEFT JOIN (
         SELECT
           r.mod_id,
           COUNT(DISTINCT r.id)::bigint AS record_count,
           COUNT(s.id)::bigint AS string_count,
           COUNT(t.id)::bigint AS translated_count,
           COUNT(*) FILTER (WHERE t.status IN ${APPROVED_STATUS_SQL})::bigint AS approved_count,
           COUNT(*) FILTER (WHERE t.status = 'fuzzy')::bigint AS fuzzy_count
         FROM records r
         JOIN strings s ON s.record_id = r.id AND s.lang = $1
         LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
         GROUP BY r.mod_id
       ) st ON st.mod_id = m.id
       ${whereClause}
       ORDER BY m.created_at DESC`,
      params,
    );

  const { rows } = await queryMods();
  return rows;
};

export const getMod = async (db: Tx, id: number) => {
  const { rows } = await db.query(`SELECT * FROM mods WHERE id = $1`, [id]);
  return rows[0];
};

export const getModsByIds = async (db: Tx, ids: number[]) => {
  if (ids.length === 0) return [];
  const { rows } = await db.query<{
    id: number;
    name: string;
    abs_path: string | null;
    game: string | null;
  }>(`SELECT id, name, abs_path, game FROM mods WHERE id = ANY($1::int[])`, [ids]);
  return rows;
};

/**
 * Languages actually present on a mod (source `strings` + target `translations`).
 * Used by apply-from-mod and editor language pickers.
 */
export const listModLangs = async (db: Tx, modId: number): Promise<string[]> => {
  const { rows } = await db.query<{ lang: string }>(
    `SELECT DISTINCT lang FROM (
       SELECT s.lang
       FROM strings s
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1 AND s.lang IS NOT NULL
       UNION
       SELECT t.target_lang AS lang
       FROM translations t
       JOIN strings s ON t.src_string_id = s.id
       JOIN records r ON s.record_id = r.id
       WHERE r.mod_id = $1
     ) langs
     ORDER BY lang`,
    [modId],
  );
  return rows.map((r) => r.lang);
};
