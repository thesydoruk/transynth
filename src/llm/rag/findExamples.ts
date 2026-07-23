import type { Tx } from '../../db';
import { logRag } from '../../logging/loggers';
import { RAG_DEFAULTS, clampRagMaxExamples } from '../ragConstants';
import { normalizeForHash } from '../../utils/textNorm';
import type { FindReferenceExamplesOpts, RagCandidate, RagReferenceExample } from './types';
import { requirePgvectorForRag } from './pgvector';
import { buildEmbeddingInput, embedTextsForRag } from './embedding';
import { fetchTmCandidates } from './tmRetrieval';
import { fetchEmbeddingCandidates } from './embeddingRetrieval';
import { rankCandidates, toPublicExample } from './candidates';

/**
 * Hybrid retrieval: TM candidates first, then embedding similarity.
 */
export const findReferenceExamples = async (
  db: Tx,
  opts: FindReferenceExamplesOpts,
): Promise<RagReferenceExample[]> => {
  if (opts.disableRag) return [];

  await requirePgvectorForRag(db);

  const maxExamples = clampRagMaxExamples(opts.maxExamples);
  const minSimilarity = opts.minSimilarity ?? RAG_DEFAULTS.minSimilarity;
  const textNorm = opts.textNorm ?? normalizeForHash(opts.sourceText);
  const textNormNopunct = opts.textNormNopunct ?? null;

  logRag.debug('findReferenceExamples start', {
    stringId: opts.stringId,
    maxExamples,
    minSimilarity,
    srcLang: opts.srcLang,
    targetLang: opts.targetLang,
    modId: opts.modId ?? null,
  });

  const tmCandidates = await fetchTmCandidates(
    db,
    opts.stringId,
    opts.sourceText,
    textNorm,
    textNormNopunct,
    opts.targetLang,
    maxExamples * 2,
    opts.modId,
  );

  const merged = new Map<string, RagCandidate>();
  for (const c of tmCandidates) merged.set(c.key, c);

  if (merged.size < maxExamples) {
    const embedInput = buildEmbeddingInput({
      sourceText: opts.sourceText,
      signature: opts.signature,
      path: opts.path,
      context: opts.context,
    });
    const [queryVec] = await embedTextsForRag([embedInput]);
    const embedCandidates = await fetchEmbeddingCandidates(
      db,
      queryVec,
      opts.srcLang,
      opts.targetLang,
      opts.stringId,
      maxExamples * 2,
      minSimilarity,
      opts.modId,
    );
    for (const c of embedCandidates) {
      if (!merged.has(c.key)) merged.set(c.key, c);
    }
  }

  const examples = rankCandidates([...merged.values()])
    .slice(0, maxExamples)
    .map(toPublicExample);

  logRag.debug('findReferenceExamples done', {
    stringId: opts.stringId,
    tmCount: tmCandidates.length,
    mergedCount: merged.size,
    returned: examples.length,
    methods: examples.map((e) => e.match_method),
  });

  return examples;
};
