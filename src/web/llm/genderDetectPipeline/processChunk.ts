import { getTranslateModel } from '../../../config';
import { inferNarratorGenderHeuristic } from '../../../dialog/narratorGenderHeuristics';
import {
  detectNarratorGenderWithLlm,
  isLlmNarratorGenderMissingIdsError,
  type LlmNarratorGenderItem,
} from '../../../llm/narratorGenderDetect';
import { parseRecordLocation } from '../../../utils/recordLocation';
import { enqueueSoloChunks } from '../../../llm/chunkRecovery';
import { logTranslate } from '../../../logging/loggers';
import type { GenderDetectRecordRow } from '../../data/queries/narratorGender';
import type { GenderDetectChunkResult, RunModGenderDetectPipelineOpts } from './types';

const toLlmItems = (rows: readonly GenderDetectRecordRow[]): LlmNarratorGenderItem[] =>
  rows.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    return {
      id: row.record_id,
      source_excerpt: row.source_excerpt,
      grup,
      edid: row.edid,
      field,
      path: row.path,
    };
  });

const heuristicResults = (chunk: readonly GenderDetectRecordRow[]): GenderDetectChunkResult[] => {
  const out: GenderDetectChunkResult[] = [];
  for (const row of chunk) {
    const hit = inferNarratorGenderHeuristic({ source: row.source_excerpt, edid: row.edid });
    if (!hit || hit.confidence < 0.7) continue;
    out.push({
      recordId: row.record_id,
      gender: hit.gender,
      source: hit.reason.includes('edid') ? 'edid' : 'heuristic',
    });
  }
  return out;
};

const llmForRows = async (
  opts: RunModGenderDetectPipelineOpts,
  rows: readonly GenderDetectRecordRow[],
): Promise<GenderDetectChunkResult[]> => {
  const llmResults = await detectNarratorGenderWithLlm({
    items: toLlmItems(rows),
    model: getTranslateModel(),
    srcLang: opts.srcLang,
    game: opts.game,
    modName: opts.modName,
    signal: opts.signal,
  });

  return llmResults.map((result) => ({
    recordId: result.id,
    gender: result.narrator_gender,
    source: 'llm' as const,
    llmResult: result,
  }));
};

export const processGenderDetectChunk = async (
  chunk: readonly GenderDetectRecordRow[],
  opts: RunModGenderDetectPipelineOpts,
  enqueueSplit?: (parts: readonly (readonly GenderDetectRecordRow[])[]) => void,
): Promise<GenderDetectChunkResult[]> => {
  const useLlm = opts.useLlm === true;
  const heuristicHits = heuristicResults(chunk);
  const resolvedIds = new Set(heuristicHits.map((r) => r.recordId));

  const needsLlm = chunk.filter((row) => !resolvedIds.has(row.record_id));
  if (!useLlm || needsLlm.length === 0) return heuristicHits;

  try {
    const llmHits = await llmForRows(opts, needsLlm);
    return [...heuristicHits, ...llmHits];
  } catch (err) {
    if (isLlmNarratorGenderMissingIdsError(err) && enqueueSplit && needsLlm.length > 1) {
      enqueueSoloChunks(needsLlm, enqueueSplit);
      return heuristicHits;
    }
    if (needsLlm.length === 1) {
      logTranslate.warn('gender-detect LLM failed for solo record', {
        recordId: needsLlm[0]!.record_id,
        err: err instanceof Error ? err.message : String(err),
      });
      return [
        ...heuristicHits,
        { recordId: needsLlm[0]!.record_id, gender: 'unknown', source: 'llm' },
      ];
    }
    throw err;
  }
};
