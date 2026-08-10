import { getTranslateModel } from '../../../../../src/config';
import {
  detectStressPlacementWithLlm,
  isLlmStressPlacementMissingIdsError,
} from '../../../../../src/llm/stressPlacement';
import { enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import type { StressPlaceRow } from '../../../../../src/web/data/queries/stressPlacement';
import { stressedMatchesSource } from '../../../../../src/voice/stressedTranslation';
import { logTranslate } from '../../../../../src/logging/loggers';
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
      enableThinking: opts.enableThinking,
    });
    const byId = new Map(llmResults.map((r) => [r.id, r.text_stressed]));
    const accepted: StressPlaceChunkResult[] = [];
    const drifted: StressPlaceRow[] = [];
    for (const row of chunk) {
      const textStressed = byId.get(row.translation_id);
      if (!textStressed) continue;
      if (!stressedMatchesSource(textStressed, row.translation)) {
        drifted.push(row);
        continue;
      }
      accepted.push({
        translationId: row.translation_id,
        textStressed,
        srcText: row.translation,
      });
    }
    if (drifted.length > 0) {
      if (chunk.length > 1 && enqueueSplit) {
        enqueueSoloChunks(drifted, enqueueSplit);
      } else {
        logTranslate.warn('stress-place rejected drifted LLM output', {
          modId: opts.modId,
          translationIds: drifted.map((row) => row.translation_id),
        });
      }
    }
    return accepted;
  } catch (err) {
    if (!isLlmStressPlacementMissingIdsError(err) || chunk.length <= 1 || !enqueueSplit) {
      throw err;
    }
    enqueueSoloChunks(chunk, enqueueSplit);
    return [];
  }
};
