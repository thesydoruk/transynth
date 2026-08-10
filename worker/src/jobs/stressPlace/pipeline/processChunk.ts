import { getTranslateModel } from '../../../../../src/config';
import {
  detectStressPlacementWithLlm,
  isLlmStressPlacementMissingIdsError,
} from '../../../../../src/llm/stressPlacement';
import { enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import type { StressPlaceRow } from '../../../../../src/web/data/queries/stressPlacement';
import type { RunModStressPlacePipelineOpts } from './runPipeline';

export type StressPlaceChunkResult = {
  translationId: number;
  textStressed: string;
  srcText: string;
};

export const processStressPlaceChunk = async (
  chunk: readonly StressPlaceRow[],
  opts: RunModStressPlacePipelineOpts,
  enqueueSplit?: (parts: readonly (readonly StressPlaceRow[])[]) => void,
): Promise<StressPlaceChunkResult[]> => {
  try {
    const llmResults = await detectStressPlacementWithLlm({
      items: chunk.map((row) => ({ id: row.translation_id, text: row.translation })),
      model: getTranslateModel(),
      targetLang: opts.targetLang,
      signal: opts.signal,
    });
    const byId = new Map(llmResults.map((r) => [r.id, r.text_stressed]));
    return chunk.flatMap((row) => {
      const textStressed = byId.get(row.translation_id);
      if (!textStressed) return [];
      return [{ translationId: row.translation_id, textStressed, srcText: row.translation }];
    });
  } catch (err) {
    if (!isLlmStressPlacementMissingIdsError(err) || chunk.length <= 1 || !enqueueSplit) {
      throw err;
    }
    enqueueSoloChunks(chunk, enqueueSplit);
    return [];
  }
};
