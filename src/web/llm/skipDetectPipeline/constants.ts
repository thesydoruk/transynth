import { CONFIG } from '../../../config';

/** Rows per LLM HTTP request — defaults to BATCH_SIZE (skip-detect has no RAG). */
export const SKIP_DETECT_LLM_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.LLM_SKIP_DETECT_BATCH_SIZE || String(CONFIG.batchSize), 10),
);
