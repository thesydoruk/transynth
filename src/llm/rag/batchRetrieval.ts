import type { Tx } from '../../db';
import { CONFIG } from '../../config';
import { logRag } from '../../logging/loggers';
import { clampRagMaxExamples } from '../ragConstants';
import { normalizeForHash } from '../../utils/textNorm';
import { mapWithConcurrency } from '../../utils/concurrency';
import type {
  FetchReferenceExamplesBatchItem,
  PendingEmbedRow,
  RagReferenceExample,
  RagRetrievalOptions,
} from './types';
import { requirePgvectorForRag } from './pgvector';
import { buildEmbeddingInput, embedTextsForRagResilient } from './embedding';
import { fetchTmCandidatesBulk } from './tmRetrieval';
import { fetchEmbeddingCandidates } from './embeddingRetrieval';
import { finalizePendingEmbedRow, rankCandidates, toPublicExample } from './candidates';

/**
 * Fetch reference examples for a batch of strings.
 *
 * TM: two bulk SQL queries (exact + punct_norm). Embedding: parallel HTTP batches
 * sized by {@link CONFIG.ragEmbedBatchSize} and {@link CONFIG.embedMaxParallel}.
 */
export const fetchReferenceExamplesBatch = async (
  db: Tx,
  items: FetchReferenceExamplesBatchItem[],
  srcLang: string,
  targetLang: string,
  maxExamples: number,
  minSimilarity: number,
  options: RagRetrievalOptions = {},
): Promise<Map<number, RagReferenceExample[]>> => {
  const disableRag = options.disableRag === true;
  const scopeModId = options.modId;

  const out = new Map<number, RagReferenceExample[]>();
  if (items.length === 0 || disableRag) return out;

  await requirePgvectorForRag(db);

  const cappedMaxExamples = clampRagMaxExamples(maxExamples);
  const tmLimit = cappedMaxExamples * 2;
  const started = Date.now();

  logRag.debug('fetchReferenceExamplesBatch start', {
    itemCount: items.length,
    maxExamples: cappedMaxExamples,
    minSimilarity,
    srcLang,
    targetLang,
    disableRag,
    scopeModId: scopeModId ?? null,
  });

  const pendingEmbed: PendingEmbedRow[] = [];

  const normalizedItems = items.map((item) => ({
    stringId: item.stringId,
    sourceText: item.sourceText,
    textNorm: item.textNorm ?? normalizeForHash(item.sourceText),
    textNormNopunct: item.textNormNopunct ?? null,
    signature: item.signature,
    path: item.path,
    context: item.context,
  }));

  const tmStarted = Date.now();
  const tmById = await fetchTmCandidatesBulk(
    db,
    normalizedItems,
    targetLang,
    srcLang,
    tmLimit,
    scopeModId,
  );
  const tmMs = Date.now() - tmStarted;

  for (const item of normalizedItems) {
    const merged = tmById.get(item.stringId) ?? new Map();
    if (merged.size < cappedMaxExamples) {
      pendingEmbed.push({
        stringId: item.stringId,
        merged,
        embedInput: buildEmbeddingInput({
          sourceText: item.sourceText,
          signature: item.signature,
          path: item.path,
          context: item.context,
        }),
      });
      continue;
    }
    out.set(
      item.stringId,
      rankCandidates([...merged.values()])
        .slice(0, cappedMaxExamples)
        .map(toPublicExample),
    );
  }

  if (pendingEmbed.length > 0) {
    const embedBatchSize = CONFIG.ragEmbedBatchSize;
    const embedSlices: PendingEmbedRow[][] = [];
    for (let offset = 0; offset < pendingEmbed.length; offset += embedBatchSize) {
      embedSlices.push(pendingEmbed.slice(offset, offset + embedBatchSize));
    }

    const vectorConcurrency = Math.max(
      2,
      Math.min(8, Math.floor((CONFIG.dbPoolMax - 4) / Math.max(1, CONFIG.embedMaxParallel))),
    );

    const embedStarted = Date.now();
    logRag.debug('batch embedding retrieval', {
      pendingCount: pendingEmbed.length,
      embedSlices: embedSlices.length,
      embedBatchSize,
      embedMaxParallel: CONFIG.embedMaxParallel,
    });

    const processEmbedSlice = async (slice: PendingEmbedRow[]): Promise<void> => {
      try {
        const vectors = await embedTextsForRagResilient(slice.map((row) => row.embedInput));
        await mapWithConcurrency(slice, vectorConcurrency, async (row, index) => {
          const embedCandidates = await fetchEmbeddingCandidates(
            db,
            vectors[index]!,
            srcLang,
            targetLang,
            row.stringId,
            tmLimit,
            minSimilarity,
            scopeModId,
          );
          for (const c of embedCandidates) {
            if (!row.merged.has(c.key)) row.merged.set(c.key, c);
          }
          finalizePendingEmbedRow(row, cappedMaxExamples, out);
        });
      } catch (err) {
        logRag.warn('rag_embed slice failed; keeping TM-only examples', {
          err: err instanceof Error ? err.message : String(err),
          sliceSize: slice.length,
        });
        for (const row of slice) {
          finalizePendingEmbedRow(row, cappedMaxExamples, out);
        }
      }
    };

    await mapWithConcurrency(embedSlices, CONFIG.embedMaxParallel, processEmbedSlice);
    const embedMs = Date.now() - embedStarted;

    if (items.length >= 50) {
      logRag.info('fetchReferenceExamplesBatch timing', {
        itemCount: items.length,
        tmOnly: pendingEmbed.length === 0,
        embedPending: pendingEmbed.length,
        tmMs,
        embedMs,
        totalMs: Date.now() - started,
      });
    }
  } else if (items.length >= 50) {
    logRag.info('fetchReferenceExamplesBatch timing', {
      itemCount: items.length,
      tmOnly: true,
      tmMs,
      totalMs: Date.now() - started,
    });
  }

  logRag.debug('fetchReferenceExamplesBatch done', {
    itemCount: items.length,
    embedQueries: pendingEmbed.length,
    withExamples: [...out.values()].filter((rows) => rows.length > 0).length,
  });

  return out;
};
