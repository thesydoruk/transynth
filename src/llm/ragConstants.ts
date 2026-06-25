/** Embedding dimensions stored in translation_examples (pgvector HNSW index). */
export const RAG_EMBED_DIMENSIONS = 1024;

/** Translation statuses eligible for the RAG index. */
export const RAG_ELIGIBLE_STATUSES = ['reviewed'] as const;

export type RagEligibleStatus = (typeof RAG_ELIGIBLE_STATUSES)[number];

/** SQL fragment: `'reviewed'` for use in `status IN (...)` clauses. */
export const RAG_ELIGIBLE_STATUSES_SQL = RAG_ELIGIBLE_STATUSES.map((s) => `'${s}'`).join(', ');

/** Max characters per example field sent to the LLM. */
export const RAG_EXAMPLE_MAX_CHARS = 500;

/** Hard cap on reference examples sent to the LLM per localization string. */
export const RAG_MAX_EXAMPLES = 10;

/** Default project-setting values (mirrors schema seed + projectSettings.ts). */
export const RAG_DEFAULTS = {
  maxExamples: 5,
  minSimilarity: 0.5,
} as const;

/** Clamp project/user max-examples to 1…{@link RAG_MAX_EXAMPLES}. */
export const clampRagMaxExamples = (value?: number): number =>
  Math.min(RAG_MAX_EXAMPLES, Math.max(1, value ?? RAG_DEFAULTS.maxExamples));
