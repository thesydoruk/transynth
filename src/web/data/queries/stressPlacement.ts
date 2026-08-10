import type { Tx } from '../../../db';
import { canSynthesizeVoiceLine } from '../../../voice/prepareVoiceTtsText';
import { infoNam1RecordsSql, INFO_NAM1_RECORD_PATHS } from '../../../voice/loadVoiceTranslations';

export type StressPlaceRow = {
  translation_id: number;
  string_id: number;
  formid_lower6: string;
  voice_variant: number;
  translation: string;
  source: string;
  edid: string | null;
  text_stressed: string | null;
  stress_src_text: string | null;
};

export type ModStressPlaceScope = 'missing' | 'all';

const stressPendingSql = `(
  t.text_stressed IS NULL
  OR BTRIM(t.text_stressed) = ''
  OR t.stress_src_text IS DISTINCT FROM t.text
)`;

const voicedCte = `WITH voiced AS (
  SELECT
    UPPER(SUBSTRING(r.formid_hex FROM 3)) AS formid_lower6,
    r.edid,
    s.id AS string_id,
    s.text_raw AS source,
    ROW_NUMBER() OVER (PARTITION BY r.id ORDER BY s.id)::int AS voice_ordinal
  FROM records r
  JOIN strings s ON s.record_id = r.id AND s.lang = $2
  WHERE r.mod_id = $1
    AND ${infoNam1RecordsSql('r', '$4')}
)`;

const baseSelect = `${voicedCte}
 SELECT t.id AS translation_id,
        v.string_id,
        v.formid_lower6,
        v.voice_ordinal AS voice_variant,
        t.text AS translation,
        v.source,
        v.edid,
        t.text_stressed,
        t.stress_src_text
   FROM voiced v
   JOIN translations t ON t.src_string_id = v.string_id AND t.target_lang = $3
  WHERE t.text IS NOT NULL AND BTRIM(t.text) <> ''`;

const isEligible = (row: StressPlaceRow): boolean =>
  canSynthesizeVoiceLine(row.source, row.translation, row.edid);

const matchesSpeaker = (
  row: StressPlaceRow,
  allowedKeys: ReadonlySet<string> | undefined,
): boolean => {
  if (!allowedKeys) return true;
  return allowedKeys.has(`${row.formid_lower6.toUpperCase()}:${row.voice_variant}`);
};

const loadChunk = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  afterId: number,
  limit: number,
  scope: ModStressPlaceScope,
): Promise<StressPlaceRow[]> => {
  const scopeFilter = scope === 'missing' ? `AND ${stressPendingSql}` : '';
  const { rows } = await db.query<StressPlaceRow>(
    `${baseSelect}
      AND t.id > $5
      ${scopeFilter}
    ORDER BY t.id
    LIMIT $6`,
    [modId, srcLang, tgtLang, [...INFO_NAM1_RECORD_PATHS], afterId, limit],
  );
  return rows;
};

export const countStressPlaceWork = async (
  db: Tx,
  modId: number,
  srcLang: string,
  tgtLang: string,
  scope: ModStressPlaceScope,
  allowedKeys?: ReadonlySet<string>,
): Promise<number> => {
  let total = 0;
  let afterId = 0;
  const pageSize = 500;
  for (;;) {
    const chunk = await loadChunk(db, modId, srcLang, tgtLang, afterId, pageSize, scope);
    if (chunk.length === 0) break;
    afterId = chunk[chunk.length - 1]!.translation_id;
    total += chunk.filter((row) => isEligible(row) && matchesSpeaker(row, allowedKeys)).length;
    if (chunk.length < pageSize) break;
  }
  return total;
};

export async function* iterateStressPlaceWorkUnits(
  db: Tx,
  opts: {
    modId: number;
    srcLang: string;
    tgtLang: string;
    scope: ModStressPlaceScope;
    allowedKeys?: ReadonlySet<string>;
    batchSize?: number;
  },
): AsyncGenerator<StressPlaceRow[]> {
  const batchSize = Math.max(1, opts.batchSize ?? 20);
  let afterId = 0;
  const pageSize = 500;
  let buffer: StressPlaceRow[] = [];

  for (;;) {
    const chunk = await loadChunk(
      db,
      opts.modId,
      opts.srcLang,
      opts.tgtLang,
      afterId,
      pageSize,
      opts.scope,
    );
    if (chunk.length === 0) break;
    afterId = chunk[chunk.length - 1]!.translation_id;

    for (const row of chunk) {
      if (!isEligible(row) || !matchesSpeaker(row, opts.allowedKeys)) continue;
      buffer.push(row);
      if (buffer.length >= batchSize) {
        yield buffer;
        buffer = [];
      }
    }
    if (chunk.length < pageSize) break;
  }
  if (buffer.length > 0) yield buffer;
}

export const persistStressPlacementResults = async (
  db: Tx,
  rows: ReadonlyArray<{ translationId: number; textStressed: string; srcText: string }>,
): Promise<void> => {
  if (rows.length === 0) return;
  for (const row of rows) {
    await db.query(
      `UPDATE translations
          SET text_stressed = $2,
              stress_src_text = $3,
              stress_source = 'llm',
              updated_at = NOW()
        WHERE id = $1`,
      [row.translationId, row.textStressed, row.srcText],
    );
  }
};

export const resetModStressPlaceState = async (
  db: Tx,
  modId: number,
  tgtLang: string,
): Promise<number> => {
  const { rowCount } = await db.query(
    `UPDATE translations t
        SET text_stressed = NULL,
            stress_src_text = NULL,
            stress_source = NULL,
            updated_at = NOW()
      FROM strings s
      JOIN records r ON r.id = s.record_id
     WHERE t.src_string_id = s.id
       AND r.mod_id = $1
       AND t.target_lang = $2
       AND t.text_stressed IS NOT NULL`,
    [modId, tgtLang],
  );
  return rowCount ?? 0;
};

export const saveStressedTranslation = async (
  db: Tx,
  translationId: number,
  textStressed: string,
): Promise<{ textStressed: string | null }> => {
  const trimmed = textStressed.trim();
  if (!trimmed) {
    await db.query(
      `UPDATE translations
          SET text_stressed = NULL, stress_src_text = NULL, stress_source = NULL, updated_at = NOW()
        WHERE id = $1`,
      [translationId],
    );
    return { textStressed: null };
  }
  const { rows } = await db.query<{ text_stressed: string | null }>(
    `UPDATE translations t
        SET text_stressed = $2,
            stress_src_text = t.text,
            stress_source = 'human',
            updated_at = NOW()
      WHERE t.id = $1
      RETURNING t.text_stressed`,
    [translationId, trimmed],
  );
  return { textStressed: rows[0]?.text_stressed ?? trimmed };
};
