import { getTranslateModel } from '../../../../../src/config';
import {
  detectUnresolvedWordStressWithLlm,
  isLlmStressPlacementMissingIdsError,
  type LlmStressWordItem,
  type LlmStressWordResult,
} from '../../../../../src/llm/stressPlacement';
import { enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import type { StressPlaceRow } from '../../../../../src/web/data/queries/stressPlacement';
import { stressedMatchesSource } from '../../../../../src/voice/stressedTranslation';
import { getUkStressDictionary } from '../../../../../src/voice/ukStress/dictionary';
import {
  mergeLlmWordStress,
  placeLineWithDictionary,
  type UnresolvedStressWord,
} from '../../../../../src/voice/ukStress/placeLine';
import { logTranslate } from '../../../../../src/logging/loggers';
import type { RunModStressPlacePipelineOpts } from './runPipeline';

export type StressPlaceChunkResult = {
  translationId: number;
  textStressed: string;
  srcText: string;
};

type LinePrep = {
  row: StressPlaceRow;
  partialStressed: string;
  unresolved: UnresolvedStressWord[];
};

const applyLlmResults = (
  results: readonly LlmStressWordResult[],
  llmMeta: ReadonlyMap<number, { lineIndex: number; tokenIndex: number }>,
  stressedByLine: Map<number, string>[],
): void => {
  for (const result of results) {
    const meta = llmMeta.get(result.id);
    if (!meta) continue;
    stressedByLine[meta.lineIndex].set(meta.tokenIndex, result.word_stressed);
  }
};

const toAccepted = (
  prepared: readonly LinePrep[],
  stressedByLine: readonly Map<number, string>[],
): { accepted: StressPlaceChunkResult[]; drifted: StressPlaceRow[] } => {
  const accepted: StressPlaceChunkResult[] = [];
  const drifted: StressPlaceRow[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const prep = prepared[i];
    const textStressed = mergeLlmWordStress(prep.partialStressed, stressedByLine[i]);
    if (!stressedMatchesSource(textStressed, prep.row.translation)) {
      drifted.push(prep.row);
      continue;
    }
    accepted.push({
      translationId: prep.row.translation_id,
      textStressed,
      srcText: prep.row.translation,
    });
  }
  return { accepted, drifted };
};

export const processStressPlaceChunk = async (
  chunk: readonly StressPlaceRow[],
  opts: RunModStressPlacePipelineOpts,
  enqueueSplit?: (parts: readonly (readonly StressPlaceRow[])[]) => void,
): Promise<StressPlaceChunkResult[]> => {
  const dict = await getUkStressDictionary();
  const prepared: LinePrep[] = chunk.map((row) => {
    const placed = placeLineWithDictionary(dict, row.translation);
    return {
      row,
      partialStressed: placed.partialStressed,
      unresolved: placed.unresolved,
    };
  });

  const llmWords: LlmStressWordItem[] = [];
  const llmMeta = new Map<number, { lineIndex: number; tokenIndex: number }>();
  let nextId = 1;
  for (let lineIndex = 0; lineIndex < prepared.length; lineIndex++) {
    const prep = prepared[lineIndex];
    for (const word of prep.unresolved) {
      const id = nextId++;
      llmWords.push({
        id,
        word: word.word,
        context: prep.row.translation,
        wordIndex: word.tokenIndex,
      });
      llmMeta.set(id, { lineIndex, tokenIndex: word.tokenIndex });
    }
  }

  const stressedByLine = prepared.map(() => new Map<number, string>());
  let splitForLlmRetry = false;

  if (llmWords.length > 0) {
    try {
      const llmResults = await detectUnresolvedWordStressWithLlm({
        words: llmWords,
        model: getTranslateModel(),
        targetLang: opts.targetLang,
        signal: opts.signal,
        enableThinking: opts.enableThinking,
      });
      applyLlmResults(llmResults, llmMeta, stressedByLine);
    } catch (err) {
      if (isLlmStressPlacementMissingIdsError(err)) {
        applyLlmResults(err.partialResults, llmMeta, stressedByLine);
        if (chunk.length > 1 && enqueueSplit) {
          splitForLlmRetry = true;
        }
      } else {
        logTranslate.warn('stress-place LLM failed; keeping dictionary marks', {
          modId: opts.modId,
          error: err instanceof Error ? err.message : String(err),
          wordCount: llmWords.length,
        });
        if (chunk.length > 1 && enqueueSplit) {
          splitForLlmRetry = true;
        }
      }
    }
  }

  if (splitForLlmRetry && enqueueSplit) {
    // Save dictionary-only lines now; retry only rows that still need LLM words.
    const dictOnly: LinePrep[] = [];
    const needsLlm: StressPlaceRow[] = [];
    for (const prep of prepared) {
      if (prep.unresolved.length === 0) dictOnly.push(prep);
      else needsLlm.push(prep.row);
    }
    if (needsLlm.length > 0) enqueueSoloChunks(needsLlm, enqueueSplit);
    const { accepted, drifted } = toAccepted(
      dictOnly,
      dictOnly.map(() => new Map()),
    );
    if (drifted.length > 0) {
      logTranslate.warn('stress-place rejected drifted dictionary output', {
        modId: opts.modId,
        translationIds: drifted.map((row) => row.translation_id),
      });
    }
    return accepted;
  }

  const { accepted, drifted } = toAccepted(prepared, stressedByLine);
  if (drifted.length > 0) {
    if (chunk.length > 1 && enqueueSplit) {
      enqueueSoloChunks(drifted, enqueueSplit);
    } else {
      logTranslate.warn('stress-place rejected drifted hybrid output', {
        modId: opts.modId,
        translationIds: drifted.map((row) => row.translation_id),
      });
    }
  }
  return accepted;
};
