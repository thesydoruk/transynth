import type { Tx } from '../../../../../src/db';
import { CONFIG } from '../../../../../src/config';
import { groupMcmPairsForTranslate } from '../../../../../src/formats/mcm';
import { partitionByPromptFamily, type LlmPromptFamily } from '../../../../../src/llm/promptFamily';
import {
  chunkFo4DialogFamily,
  loadFo4DialogLineGroups,
} from '../../../../../src/llm/fo4DialogChunks';
import type { DialogSceneContext } from '../../../../../src/llm/dialogScene';
import { buildLlmTranslateChunks } from '../chunking';
import type { PreparedLlmItem } from './types';

const chunkOpts = () => ({
  batchSize: CONFIG.batchSize,
  maxSourceChars: CONFIG.llmBatchMaxSourceChars,
  singleRowMaxSourceChars: CONFIG.llmBatchMaxSingleSourceChars,
});

const stamp = (
  items: PreparedLlmItem[],
  family: LlmPromptFamily,
  scene?: DialogSceneContext,
): PreparedLlmItem[] =>
  items.map((item) => ({
    ...item,
    promptFamily: family,
    ...(scene ? { dialogScene: scene } : {}),
  }));

/** Split pending rows by prompt family; dialog stays in scene windows. */
export const buildFamilyTranslateChunks = async (
  db: Tx,
  items: PreparedLlmItem[],
  game: string | null,
): Promise<PreparedLlmItem[][]> => {
  const buckets = partitionByPromptFamily(game, items);
  const chunks: PreparedLlmItem[][] = [];
  const opts = chunkOpts();

  for (const [family, familyItems] of buckets) {
    if (family === 'dialog') {
      const groups = await loadFo4DialogLineGroups(
        db,
        familyItems.map((item) => item.stringId),
      );
      for (const { items: part, scene } of chunkFo4DialogFamily(familyItems, groups, {
        maxTargets: opts.batchSize,
        singleRowMaxSourceChars: opts.singleRowMaxSourceChars,
      })) {
        chunks.push(stamp(part, 'dialog', scene));
      }
      continue;
    }

    const prepared =
      family === 'mcm' || family === 'default'
        ? groupMcmPairsForTranslate(familyItems)
        : familyItems;
    for (const part of buildLlmTranslateChunks(prepared, opts)) {
      chunks.push(stamp(part, family));
    }
  }

  return chunks;
};
