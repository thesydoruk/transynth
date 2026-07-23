/** One retrieved example passed to the LLM. */
export type RagReferenceExample = {
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  match_method: 'exact' | 'numeric' | 'punct_norm' | 'fuzzy' | 'embedding';
  similarity: number;
};

export type RagStats = {
  pgvectorAvailable: boolean;
  indexedCount: number;
  eligibleCount: number;
  embedModel: string;
  embedDimensions: number;
};

export type RagCandidate = {
  key: string;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  match_method: RagReferenceExample['match_method'];
  similarity: number;
};

export type TranslationRow = {
  translation_id: number;
  src_string_id: number;
  src_lang: string;
  target_lang: string;
  source_text: string;
  translation_text: string;
  signature: string | null;
  path: string | null;
  context: string | null;
  game: string | null;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  status: string;
};

export type TmMatchRow = {
  text: string;
  source_text: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
};

export type FindReferenceExamplesOpts = {
  stringId: number;
  sourceText: string;
  textNorm?: string | null;
  textNormNopunct?: string | null;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
  srcLang: string;
  targetLang: string;
  maxExamples?: number;
  minSimilarity?: number;
  disableRag?: boolean;
  modId?: number;
};

export type FetchReferenceExamplesBatchItem = {
  stringId: number;
  sourceText: string;
  textNorm?: string | null;
  textNormNopunct?: string | null;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
};

/** Controls hybrid RAG retrieval (translation memory + embedding similarity). */
export type RagRetrievalOptions = {
  /** Skip all reference-example retrieval (no TM, no embedding). */
  disableRag?: boolean;
  /** Limit TM and embedding candidates to this mod (global corpus when omitted). */
  modId?: number;
};

export type ReindexResult = {
  indexed: number;
  skipped: number;
  failed: number;
  total: number;
};

export type PendingEmbedRow = {
  stringId: number;
  merged: Map<string, RagCandidate>;
  embedInput: string;
};
