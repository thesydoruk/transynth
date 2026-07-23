import type { Tx } from '../../db';
import { RAG_ELIGIBLE_STATUSES_SQL } from '../ragConstants';
import type { RagCandidate } from './types';
import { candidateKey } from './candidates';
import { vectorLiteral } from './embedding';

export const fetchEmbeddingCandidates = async (
  db: Tx,
  queryVector: number[],
  srcLang: string,
  targetLang: string,
  excludeStringId: number,
  limit: number,
  minSimilarity: number,
  modId?: number,
): Promise<RagCandidate[]> => {
  const literal = vectorLiteral(queryVector);
  const modFilter = modId != null ? 'AND r.mod_id = $7' : '';
  const params: unknown[] = [literal, srcLang, targetLang, excludeStringId, minSimilarity, limit];
  if (modId != null) params.push(modId);

  const { rows } = await db.query<{
    source_text: string;
    translation_text: string;
    signature: string | null;
    path: string | null;
    edid: string | null;
    similarity: number;
  }>(
    `SELECT te.source_text, te.translation_text, te.signature, te.path, r.edid,
            (1 - (te.embedding <=> $1::vector))::double precision AS similarity
     FROM translation_examples te
     JOIN translations t ON t.id = te.translation_id
     JOIN strings s ON s.id = te.src_string_id
     JOIN records r ON r.id = s.record_id
     WHERE te.src_lang = $2 AND te.target_lang = $3
       AND te.src_string_id <> $4
       AND t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})
       AND (1 - (te.embedding <=> $1::vector)) >= $5
       ${modFilter}
     ORDER BY te.embedding <=> $1::vector
     LIMIT $6`,
    params,
  );

  return rows.map((row) => ({
    key: candidateKey(row.source_text, row.translation_text),
    source: row.source_text,
    translation: row.translation_text,
    signature: row.signature,
    path: row.path,
    edid: row.edid,
    match_method: 'embedding' as const,
    similarity: row.similarity,
  }));
};
