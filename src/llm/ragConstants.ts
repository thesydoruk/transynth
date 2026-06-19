/** Embedding dimensions stored in translation_examples (pgvector HNSW index). */
export const RAG_EMBED_DIMENSIONS = 1024;

/** Translation statuses eligible for the RAG index. */
export const RAG_ELIGIBLE_STATUSES = ['reviewed', 'human'] as const;

/** Max characters per example field sent to the LLM. */
export const RAG_EXAMPLE_MAX_CHARS = 500;

/** Default project-setting values (mirrors schema seed + projectSettings.ts). */
export const RAG_DEFAULTS = {
  enabled: true,
  maxExamples: 5,
  minSimilarity: 0.5,
} as const;
