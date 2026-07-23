import { RAG_ELIGIBLE_STATUSES_SQL, RAG_EXAMPLE_MAX_CHARS } from '../ragConstants';
import { extractNumbers, transplantNumbers } from '../../utils/textNorm';
import { parseRecordLocation } from '../../utils/recordLocation';
import type { RagCandidate, RagReferenceExample, TmMatchRow } from './types';

export const RAG_STATUS_FILTER = `t.status IN (${RAG_ELIGIBLE_STATUSES_SQL})`;

const truncate = (text: string, max = RAG_EXAMPLE_MAX_CHARS): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export const candidateKey = (source: string, translation: string): string =>
  `${source}\0${translation}`;

export const toPublicExample = (row: RagCandidate): RagReferenceExample => {
  const { grup, field } = parseRecordLocation(row.signature, row.path);
  return {
    source: truncate(row.source),
    translation: truncate(row.translation),
    grup,
    edid: row.edid,
    field,
    match_method: row.match_method,
    similarity: row.similarity,
  };
};

export const addTmCandidates = (
  merged: Map<string, RagCandidate>,
  rows: TmMatchRow[],
  method: RagReferenceExample['match_method'],
  similarity: number,
  limit: number,
): void => {
  for (const row of rows) {
    if (merged.size >= limit) return;
    const key = candidateKey(row.source_text, row.text);
    if (merged.has(key)) continue;
    merged.set(key, {
      key,
      source: row.source_text,
      translation: row.text,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      match_method: method,
      similarity,
    });
  }
};

export const addExactNormCandidates = (
  merged: Map<string, RagCandidate>,
  queryRaw: string,
  rows: TmMatchRow[],
  limit: number,
): void => {
  for (const row of rows) {
    if (merged.size >= limit) return;
    if (row.source_text === queryRaw) {
      addTmCandidates(merged, [row], 'exact', 1.0, limit);
    } else {
      const transplanted = transplantNumbers(
        row.text,
        extractNumbers(row.source_text),
        extractNumbers(queryRaw),
      );
      if (transplanted !== null) {
        addTmCandidates(merged, [{ ...row, text: transplanted }], 'numeric', 0.95, limit);
      } else {
        addTmCandidates(merged, [row], 'exact', 0.9, limit);
      }
    }
  }
};

export const groupBulkTmRows = <T extends { query_id: number }>(rows: T[]): Map<number, T[]> => {
  const byId = new Map<number, T[]>();
  for (const row of rows) {
    const list = byId.get(row.query_id);
    if (list) list.push(row);
    else byId.set(row.query_id, [row]);
  }
  return byId;
};

/** SQL fragment restricting candidate rows to one mod (`records.mod_id`). */
export const ragModFilterSql = (modId: number | undefined, paramIndex: number): string =>
  modId != null ? `AND r.mod_id = $${paramIndex}` : '';

export const rankCandidates = (candidates: RagCandidate[]): RagCandidate[] => {
  const methodWeight: Record<RagReferenceExample['match_method'], number> = {
    exact: 1.0,
    numeric: 0.92,
    punct_norm: 0.85,
    fuzzy: 0.7,
    embedding: 0.65,
  };

  return [...candidates].sort((a, b) => {
    const scoreA = (methodWeight[a.match_method] ?? 0.5) * a.similarity;
    const scoreB = (methodWeight[b.match_method] ?? 0.5) * b.similarity;
    return scoreB - scoreA;
  });
};

export const finalizePendingEmbedRow = (
  row: { stringId: number; merged: Map<string, RagCandidate> },
  cappedMaxExamples: number,
  out: Map<number, RagReferenceExample[]>,
): void => {
  out.set(
    row.stringId,
    rankCandidates([...row.merged.values()])
      .slice(0, cappedMaxExamples)
      .map(toPublicExample),
  );
};
