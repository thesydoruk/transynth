import { CONFIG, getTranslateModel } from '../../../config';
import { partitionSkipAuditRows } from '../../../llm/skipTranslateHeuristics';
import {
  detectSkipCandidatesWithLlm,
  isLlmSkipDetectMissingIdsError,
  type LlmSkipDetectItem,
  type LlmSkipDetectItemResult,
} from '../../../llm/skipTranslateDetect';
import { parseRecordLocation } from '../../../utils/recordLocation';
import { enqueueSoloChunks, runLlmChunkWithRecovery } from '../../../llm/chunkRecovery';
import { withRequestDeadline } from '../../../llm/requestDeadline';
import { isLlmTimeoutError } from '../../../llm/retry';
import { logVerify } from '../../../logging/loggers';
import type { LlmSkipDetectCandidate, ScanStringRow } from '../skipDetectService/queries';
import { SKIP_DETECT_LLM_BATCH_SIZE } from './constants';
import type { RunModSkipDetectPipelineOpts } from './types';

const rowById = (chunk: readonly ScanStringRow[]): Map<number, ScanStringRow> => {
  const map = new Map<number, ScanStringRow>();
  for (const row of chunk) map.set(row.string_id, row);
  return map;
};

const toLlmItems = (rows: readonly ScanStringRow[]): LlmSkipDetectItem[] =>
  rows.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    return {
      id: row.string_id,
      source: row.source,
      grup,
      edid: row.edid,
      field,
      path: row.path,
      context: row.context,
    };
  });

const mergeLlmSkipHits = (
  hits: Map<number, LlmSkipDetectCandidate>,
  llmHits: readonly LlmSkipDetectItemResult[],
  rows: Map<number, ScanStringRow>,
): void => {
  for (const llmHit of llmHits) {
    const row = rows.get(llmHit.id);
    if (!row) continue;
    const existing = hits.get(llmHit.id);
    hits.set(llmHit.id, {
      stringId: llmHit.id,
      source: row.source,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      reason: llmHit.reason,
      confidence: llmHit.confidence,
      method: existing ? 'both' : 'llm',
    });
  }
};

const enqueueSoloSkipDetectRows = (
  llmItems: readonly LlmSkipDetectItem[],
  rows: Map<number, ScanStringRow>,
  enqueueSplit: (parts: readonly (readonly ScanStringRow[])[]) => void,
): void => {
  const scanRows = llmItems
    .map((item) => rows.get(item.id))
    .filter((row): row is ScanStringRow => row != null);
  enqueueSoloChunks(scanRows, enqueueSplit);
};

export const processSkipDetectChunk = async (
  chunk: readonly ScanStringRow[],
  opts: RunModSkipDetectPipelineOpts,
  enqueueSplit?: (parts: readonly (readonly ScanStringRow[])[]) => void,
): Promise<LlmSkipDetectCandidate[]> => {
  const useLlm = opts.useLlm === true;
  const shouldCancel = opts.shouldCancel;
  const rows = rowById(chunk);

  const auditRows = chunk.map((row) => {
    const { grup } = parseRecordLocation(row.signature, row.path);
    return {
      id: row.string_id,
      source: row.source,
      edid: row.edid,
      path: row.path,
      signature: grup,
      context: row.context,
    };
  });

  const { heuristicHits } = partitionSkipAuditRows(auditRows);
  const hits = new Map<number, LlmSkipDetectCandidate>();

  for (const row of chunk) {
    const heuristic = heuristicHits.get(row.string_id);
    if (!heuristic) continue;
    hits.set(row.string_id, {
      stringId: row.string_id,
      source: row.source,
      signature: row.signature,
      path: row.path,
      edid: row.edid,
      reason: heuristic.reason,
      confidence: 0.85,
      method: 'heuristic',
    });
  }

  const llmRows = chunk.filter((row) => !heuristicHits.has(row.string_id));
  if (useLlm && llmRows.length > 0 && !shouldCancel?.()) {
    const model = getTranslateModel();
    const items = toLlmItems(llmRows);

    for (let i = 0; i < items.length; i += SKIP_DETECT_LLM_BATCH_SIZE) {
      if (shouldCancel?.()) break;
      const batch = items.slice(i, i + SKIP_DETECT_LLM_BATCH_SIZE);

      await runLlmChunkWithRecovery({
        chunk: batch,
        shouldAbort: shouldCancel,
        enqueueSplit: enqueueSplit
          ? (parts) => {
              for (const part of parts) {
                enqueueSoloSkipDetectRows(part, rows, enqueueSplit);
              }
            }
          : undefined,
        runOnce: async (llmItems) => {
          try {
            const llmHits = await withRequestDeadline(
              CONFIG.llmRequestTimeoutMs,
              opts.signal,
              (signal) =>
                detectSkipCandidatesWithLlm({
                  items: [...llmItems],
                  model,
                  srcLang: opts.srcLang,
                  game: opts.game,
                  modName: opts.modName,
                  signal,
                }),
            );
            mergeLlmSkipHits(hits, llmHits, rows);
          } catch (err) {
            if (isLlmSkipDetectMissingIdsError(err)) {
              mergeLlmSkipHits(hits, err.partialResults, rows);
              const missingItems = llmItems.filter((item) => err.missingIds.includes(item.id));
              if (llmItems.length > 1) {
                logVerify.warn('partial LLM skip-detect batch — solo retry for missing rows', {
                  ok: llmItems.length - missingItems.length,
                  missing: missingItems.map((item) => item.id),
                });
                if (enqueueSplit) {
                  enqueueSoloSkipDetectRows(missingItems, rows, enqueueSplit);
                }
                return;
              }
              throw err;
            }
            if (isLlmTimeoutError(err) && llmItems.length > 1) {
              logVerify.warn('LLM skip-detect batch timeout — solo retry', {
                chunkSize: llmItems.length,
                itemIds: llmItems.map((item) => item.id),
              });
              if (enqueueSplit) {
                enqueueSoloSkipDetectRows(llmItems, rows, enqueueSplit);
              }
              return;
            }
            throw err;
          }
        },
        shouldSplit: (err) => isLlmSkipDetectMissingIdsError(err) || isLlmTimeoutError(err),
        onFailure: (failed, message) => {
          logVerify.warn('skip-detect LLM batch skipped after error', {
            modId: opts.modId,
            error: message,
            stringIds: failed.map((item) => item.id),
          });
        },
        log: logVerify,
        operation: 'skip_detect',
        itemIds: (c) => c.map((item) => item.id),
      });
    }
  }

  return [...hits.values()];
};
