import type { Tx } from '../../../../../src/db';
import { gamePlugin } from '../../../../../src/games/registry';
import { CONFIG, getTranslateModel } from '../../../../../src/config';
import { filterVerifyReferenceExamples } from '../../../../../src/llm/verifyReferenceExamples';
import {
  verifyTranslationsWithLlm,
  isLlmVerifyMissingIdsError,
  finalizeVerifyItemResults,
  type LlmVerifyItem,
} from '../../../../../src/llm/verifyTranslate';
import { isLlmResponseTruncatedError } from '../../../../../src/llm/translate';
import { fetchReferenceExamplesBatch, type RagRetrievalOptions } from '../../../../../src/llm/rag';
import { enqueueBisected, enqueueSoloChunks } from '../../../../../src/llm/chunkRecovery';
import { withRequestDeadline } from '../../../../../src/llm/requestDeadline';
import { isLlmTimeoutError } from '../../../../../src/llm/retry';
import { logVerify } from '../../../../../src/logging/loggers';
import { parseRecordLocation } from '../../../../../src/utils/recordLocation';
import { dialogParticipantsFromRow } from '../../../../../src/web/data/queries/dialogs';
import { buildLlmParticipantPayload } from '../../../../../src/llm/dialogParticipants';
import { mergeNarratorGender } from '../../translate/batch/mergeNarratorGender';
import { mcmKeyFromRecordPath, resolveMcmLlmContext } from '../../../../../src/formats/mcm';
import { relevantGlossaryEntries, type GlossaryEntryWithRe } from '../../shared/glossaryForLlm';
import { buildBatchPersistJob } from './buildBatchPersistJob';
import { persistPreRepairs, scheduleBatchPersist, type BatchPersistContext } from './batchPersist';
import { keepPersistedPreRepairs, preRepairGenderLeaks } from './preRepairGenderLeaks';
import {
  rowNeedsLongTextVerify,
  verifyLongTextAfterTruncation,
  verifyLongTextItem,
} from './verifyLongText';
import type { RunModVerifyPipelineOpts, VerifyChunkContext, VerifyStringRow } from './types';

type RagByStringId = Awaited<ReturnType<typeof fetchReferenceExamplesBatch>>;

const verifyLongRows = async (
  ctx: VerifyChunkContext,
  rows: VerifyStringRow[],
  ragByStringId: RagByStringId,
): Promise<void> => {
  for (const row of rows) {
    const item = buildVerifyItems([row], ragByStringId, ctx.opts.game, ctx.mcmSiblingTexts)[0]!;
    const result = await verifyLongTextItem(ctx, item);
    scheduleBatchPersist(
      ctx.persistCtx,
      buildBatchPersistJob(
        [row],
        [result],
        ctx.opts,
        ctx.fixSuspicious,
        ctx.dryRun,
        ctx.collectIssue,
      ),
    );
  }
};

export const fetchChunkRag = async (
  ctx: VerifyChunkContext,
  llmChunk: VerifyStringRow[],
): Promise<RagByStringId> => {
  if (llmChunk.length === 0 || ctx.shouldCancel?.() || ctx.rag.disableRag) return new Map();
  try {
    return await fetchReferenceExamplesBatch(
      ctx.db,
      llmChunk.map((row) => {
        const { grup } = parseRecordLocation(row.signature, row.path);
        return {
          stringId: row.string_id,
          sourceText: row.source,
          textNorm: row.text_norm,
          textNormNopunct: row.text_norm_nopunct,
          signature: grup,
          path: row.path,
          context: row.context,
        };
      }),
      ctx.opts.srcLang,
      ctx.opts.targetLang,
      ctx.ragMaxExamples,
      ctx.ragMinSimilarity,
      ctx.rag,
    );
  } catch (err) {
    logVerify.warn('RAG fetch failed for verify chunk; continuing without examples', {
      modId: ctx.opts.modId,
      err: err instanceof Error ? err.message : String(err),
      stringIds: llmChunk.map((row) => row.string_id),
    });
    return new Map();
  }
};

const buildVerifyItems = (
  llmChunk: VerifyStringRow[],
  ragByStringId: RagByStringId,
  game: string | null | undefined,
  mcmSiblingTexts?: Map<string, string>,
): LlmVerifyItem[] => {
  // Disco ships `f%$#ing` in its catalogues; the auditor has to see the word
  // the player sees. Identity for every other game.
  const uncensor = gamePlugin(game).text.restoreCensoredSpeech;
  const dialog = gamePlugin(game).dialog;
  const recordKind = gamePlugin(game).text.recordKind;
  const isSpoken = (signature: string | null): boolean =>
    dialog?.isSpokenSignature(signature) ?? false;

  return llmChunk.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    const participants = mergeNarratorGender(
      dialogParticipantsFromRow(row, field, game),
      row.narrator_gender,
      isSpoken(grup),
    );
    const context =
      recordKind(grup, field) === 'settings_menu'
        ? resolveMcmLlmContext(
            row.context,
            field ?? mcmKeyFromRecordPath(row.path),
            mcmSiblingTexts ?? new Map(),
          )
        : row.context;
    return {
      id: row.string_id,
      source: uncensor(row.source),
      translation: uncensor(row.translation),
      grup,
      edid: row.edid,
      field,
      context,
      ...buildLlmParticipantPayload(participants, { isDialogueLine: isSpoken(grup) }),
      reference_examples: filterVerifyReferenceExamples(ragByStringId.get(row.string_id), {
        grup,
        field,
        source: uncensor(row.source),
      }),
    };
  });
};

/**
 * Send the rows the detector can prove wrong to the gender pass, write what
 * it fixed, and return the chunk as the audit should see it. A dry run
 * changes nothing and reports the rows as they are.
 */
const repairBeforeAudit = async (
  ctx: VerifyChunkContext,
  rows: VerifyStringRow[],
  ragByStringId: RagByStringId,
): Promise<{ rows: VerifyStringRow[]; genderRepairAttempted: ReadonlySet<number> }> => {
  if (ctx.dryRun || ctx.shouldCancel?.()) return { rows, genderRepairAttempted: new Set() };

  const items = buildVerifyItems(rows, ragByStringId, ctx.opts.game, ctx.mcmSiblingTexts);
  const outcome = await preRepairGenderLeaks(rows, items, {
    model: ctx.model,
    srcLang: ctx.opts.srcLang,
    targetLang: ctx.opts.targetLang,
    game: ctx.opts.game,
    modName: ctx.opts.modName,
    ...(ctx.opts.signal ? { signal: ctx.opts.signal } : {}),
  });
  if (outcome.repaired.length === 0) {
    return { rows, genderRepairAttempted: outcome.attempted };
  }

  const persisted = await persistPreRepairs(ctx.persistCtx, outcome.repaired);
  const kept = keepPersistedPreRepairs(outcome, persisted);
  logVerify.info('gender leaks repaired before the audit', {
    modId: ctx.opts.modId,
    leaking: outcome.attempted.size,
    repaired: kept.repaired.length,
    stringIds: kept.repaired.map((fix) => fix.stringId),
  });
  return { rows: kept.rows, genderRepairAttempted: kept.attempted };
};

export const verifyChunkOnce = async (
  ctx: VerifyChunkContext,
  llmChunk: VerifyStringRow[],
  ragByStringId: RagByStringId,
  enqueueSplit: (parts: readonly (readonly VerifyStringRow[])[]) => void,
): Promise<void> => {
  const longRows = llmChunk.filter((row) => rowNeedsLongTextVerify(row));
  const shortRows = llmChunk.filter((row) => !rowNeedsLongTextVerify(row));

  if (longRows.length > 0) {
    await verifyLongRows(ctx, longRows, ragByStringId);
  }
  if (shortRows.length === 0) return;

  // What the detector can prove is repaired before the model is asked, so the
  // audit judges the wording that will be approved rather than one already
  // known to be wrong. Persisted here, ahead of the audit, and every path
  // below — the partial-result split, the timeout halves — carries the
  // repaired rows, whose text the database already holds.
  const { rows: normalRows, genderRepairAttempted } = await repairBeforeAudit(
    ctx,
    shortRows,
    ragByStringId,
  );
  const items = buildVerifyItems(normalRows, ragByStringId, ctx.opts.game, ctx.mcmSiblingTexts);
  const glossary = await relevantGlossaryEntries(
    ctx.glossaryAll,
    normalRows.map((row) => row.source),
  );

  try {
    const results = await withRequestDeadline(
      CONFIG.llmRequestTimeoutMs,
      ctx.opts.signal,
      (signal) =>
        verifyTranslationsWithLlm({
          items,
          model: ctx.model,
          srcLang: ctx.opts.srcLang,
          targetLang: ctx.opts.targetLang,
          game: ctx.opts.game,
          modName: ctx.opts.modName,
          glossary,
          promptFamily: normalRows[0]?.promptFamily,
          dialogScene: normalRows[0]?.dialogScene,
          signal,
        }),
    );

    scheduleBatchPersist(
      ctx.persistCtx,
      buildBatchPersistJob(
        normalRows,
        results,
        ctx.opts,
        ctx.fixSuspicious,
        ctx.dryRun,
        ctx.collectIssue,
        genderRepairAttempted,
      ),
    );
  } catch (err) {
    if (isLlmResponseTruncatedError(err) && normalRows.length === 1) {
      const row = normalRows[0]!;
      const item = items[0]!;
      const merged = await verifyLongTextAfterTruncation(ctx, item);
      if (merged != null) {
        scheduleBatchPersist(
          ctx.persistCtx,
          buildBatchPersistJob(
            [row],
            [merged],
            ctx.opts,
            ctx.fixSuspicious,
            ctx.dryRun,
            ctx.collectIssue,
          ),
        );
        return;
      }
    }
    if (isLlmVerifyMissingIdsError(err)) {
      const missingSet = new Set(err.missingIds);
      const okRows = normalRows.filter((row) => !missingSet.has(row.string_id));
      if (err.partialResults.length > 0) {
        const okItems = buildVerifyItems(okRows, ragByStringId, ctx.opts.game, ctx.mcmSiblingTexts);
        scheduleBatchPersist(
          ctx.persistCtx,
          buildBatchPersistJob(
            okRows,
            finalizeVerifyItemResults(
              okItems,
              [...err.partialResults],
              ctx.opts.game,
              ctx.opts.targetLang,
            ),
            ctx.opts,
            ctx.fixSuspicious,
            ctx.dryRun,
            ctx.collectIssue,
            genderRepairAttempted,
          ),
        );
      }
      const missingRows = normalRows.filter((row) => missingSet.has(row.string_id));
      if (normalRows.length > 1) {
        logVerify.warn('partial LLM verify batch — solo retry for missing rows', {
          ok: okRows.length,
          missing: missingRows.map((row) => row.string_id),
        });
        enqueueSoloChunks(missingRows, enqueueSplit);
        return;
      }
      throw err;
    }
    if (isLlmTimeoutError(err) && normalRows.length > 1) {
      logVerify.warn('LLM verify batch timeout — retrying in halves', {
        chunkSize: normalRows.length,
        stringIds: normalRows.map((row) => row.string_id),
      });
      enqueueBisected(normalRows, enqueueSplit);
      return;
    }
    throw err;
  }
};

export const emitChunkFailure = (
  ctx: VerifyChunkContext,
  llmChunk: readonly VerifyStringRow[],
  message: string,
): void => {
  logVerify.error('verify chunk failed; continuing', {
    modId: ctx.opts.modId,
    error: message,
    stringIds: llmChunk.map((row) => row.string_id),
  });
  for (const row of llmChunk) {
    ctx.persistCtx.counters.done++;
    ctx.persistCtx.counters.errors++;
    ctx.persistCtx.emitProgress({
      chunkError: { stringIds: [row.string_id], message },
    });
  }
};

export const createVerifyChunkContext = (
  db: Tx,
  opts: RunModVerifyPipelineOpts,
  persistCtx: BatchPersistContext,
  glossaryAll: GlossaryEntryWithRe[],
  ragMaxExamples: number,
  ragMinSimilarity: number,
  rag: RagRetrievalOptions,
  fixSuspicious: boolean,
  dryRun: boolean,
  collectIssue?: (issue: import('../queries').LlmVerifyIssue) => void,
  mcmSiblingTexts: Map<string, string> = new Map(),
): VerifyChunkContext => ({
  db,
  opts,
  model: getTranslateModel(),
  glossaryAll,
  ragMaxExamples,
  ragMinSimilarity,
  rag,
  fixSuspicious,
  dryRun,
  persistCtx,
  mcmSiblingTexts,
  shouldCancel: opts.shouldCancel,
  collectIssue,
});
