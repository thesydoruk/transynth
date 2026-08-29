import type { Tx } from '../../db';
import type { RagCandidate, TmMatchRow } from './types';
import {
  RAG_STATUS_FILTER,
  addExactNormCandidates,
  addTmCandidates,
  groupBulkTmRows,
  ragModFilterSql,
} from './candidates';

/** Two SQL round trips for TM exact + punct_norm (batch prefetch — no per-row fuzzy trigram). */
export const fetchTmCandidatesBulk = async (
  db: Tx,
  items: Array<{
    stringId: number;
    sourceText: string;
    textNorm: string;
    textNormNopunct: string | null;
  }>,
  targetLang: string,
  srcLang: string,
  limitPerItem: number,
  modId?: number,
): Promise<Map<number, Map<string, RagCandidate>>> => {
  const byId = new Map<number, Map<string, RagCandidate>>();
  for (const item of items) byId.set(item.stringId, new Map());
  if (items.length === 0) return byId;

  type BulkTmDbRow = TmMatchRow & { query_id: number; query_raw: string };

  const exactModFilter = ragModFilterSql(modId, 6);
  const exactParams: unknown[] = [
    items.map((i) => i.stringId),
    items.map((i) => i.sourceText),
    items.map((i) => i.textNorm),
    targetLang,
    srcLang,
  ];
  if (modId != null) exactParams.push(modId);

  const { rows: exactRows } = await db.query<BulkTmDbRow>(
    `WITH batch AS (
       SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[]) AS b(query_id, query_raw, text_norm)
     )
     SELECT b.query_id, b.query_raw,
            t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
     FROM batch b
     JOIN strings s ON s.text_norm = b.text_norm AND s.id <> b.query_id AND s.lang = $5
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $4
     WHERE ${RAG_STATUS_FILTER}
       ${exactModFilter}`,
    exactParams,
  );

  for (const [queryId, rows] of groupBulkTmRows(exactRows)) {
    const item = items.find((i) => i.stringId === queryId);
    if (!item) continue;
    addExactNormCandidates(byId.get(queryId)!, item.sourceText, rows, limitPerItem);
  }

  const punctItems = items.filter((item) => {
    const merged = byId.get(item.stringId);
    return (
      merged &&
      merged.size < limitPerItem &&
      item.textNormNopunct != null &&
      item.textNormNopunct !== ''
    );
  });

  if (punctItems.length > 0) {
    const punctModFilter = ragModFilterSql(modId, 7);
    const punctParams: unknown[] = [
      punctItems.map((i) => i.stringId),
      punctItems.map((i) => i.sourceText),
      punctItems.map((i) => i.textNorm),
      punctItems.map((i) => i.textNormNopunct!),
      targetLang,
      srcLang,
    ];
    if (modId != null) punctParams.push(modId);

    const { rows: punctRows } = await db.query<BulkTmDbRow>(
      `WITH batch AS (
         SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::text[]) AS b(
           query_id, query_raw, text_norm, text_norm_nopunct
         )
       )
       SELECT b.query_id, b.query_raw,
              t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
       FROM batch b
       JOIN strings s
         ON s.text_norm_nopunct = b.text_norm_nopunct
        AND s.text_norm <> b.text_norm
        AND s.id <> b.query_id
        AND s.lang = $6
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $5
       WHERE ${RAG_STATUS_FILTER}
         ${punctModFilter}`,
      punctParams,
    );

    for (const [queryId, rows] of groupBulkTmRows(punctRows)) {
      addTmCandidates(byId.get(queryId)!, rows, 'punct_norm', 0.9, limitPerItem);
    }
  }

  return byId;
};

export const fetchTmCandidates = async (
  db: Tx,
  stringId: number,
  textRaw: string,
  textNorm: string,
  textNormNopunct: string | null,
  targetLang: string,
  limit: number,
  modId?: number,
): Promise<RagCandidate[]> => {
  const merged = new Map<string, RagCandidate>();
  const limitPerQuery = limit;
  const modFilter = ragModFilterSql(modId, 5);
  const normParams: unknown[] = [textNorm, targetLang, stringId, limitPerQuery];
  if (modId != null) normParams.push(modId);

  const { rows: normRows } = await db.query<TmMatchRow>(
    `SELECT DISTINCT ON (t.text)
        t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
     FROM strings s
     JOIN records r ON r.id = s.record_id
     JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
     WHERE s.text_norm = $1 AND s.id <> $3 AND ${RAG_STATUS_FILTER}
       ${modFilter}
     ORDER BY t.text
     LIMIT $4`,
    normParams,
  );

  addExactNormCandidates(merged, textRaw, normRows, limitPerQuery);

  if (textNormNopunct && merged.size < limitPerQuery) {
    const punctModFilter = ragModFilterSql(modId, 6);
    const punctParams: unknown[] = [
      textNormNopunct,
      targetLang,
      stringId,
      limitPerQuery - merged.size,
      textNorm,
    ];
    if (modId != null) punctParams.push(modId);

    const { rows: punctRows } = await db.query<TmMatchRow>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature, r.path, r.edid
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm_nopunct = $1 AND s.text_norm <> $5 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
         ${punctModFilter}
       ORDER BY t.text
       LIMIT $4`,
      punctParams,
    );
    addTmCandidates(merged, punctRows, 'punct_norm', 0.9, limitPerQuery);
  }

  if (merged.size < limitPerQuery && textNorm.length >= 4) {
    const fuzzyModFilter = ragModFilterSql(modId, 5);
    const fuzzyParams: unknown[] = [textNorm, targetLang, stringId, limitPerQuery - merged.size];
    if (modId != null) fuzzyParams.push(modId);

    const { rows: fuzzyRows } = await db.query<TmMatchRow & { sim: number }>(
      `SELECT DISTINCT ON (t.text)
          t.text, s.text_raw AS source_text, r.signature, r.path, r.edid,
          similarity(s.text_norm, $1)::double precision AS sim
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
       WHERE s.text_norm % $1 AND s.text_norm <> $1 AND s.id <> $3
         AND ${RAG_STATUS_FILTER}
         ${fuzzyModFilter}
       ORDER BY t.text, similarity(s.text_norm, $1) DESC
       LIMIT $4`,
      fuzzyParams,
    );
    for (const row of fuzzyRows) {
      addTmCandidates(
        merged,
        [
          {
            text: row.text,
            source_text: row.source_text,
            signature: row.signature,
            path: row.path,
            edid: row.edid,
          },
        ],
        'fuzzy',
        row.sim,
        limitPerQuery,
      );
    }
  }

  return [...merged.values()];
};
