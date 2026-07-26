import type { LlmSkipDetectCandidate } from '../queries';

export type SkipDetectPipelineProgress = {
  done: number;
  total: number;
  candidateCount: number;
  markedCount: number;
  /** New hits from the latest persisted chunk (for streaming UIs). */
  candidatesBatch?: LlmSkipDetectCandidate[];
};

export type RunModSkipDetectPipelineOpts = {
  modId: number;
  srcLang: string;
  modName?: string | null;
  game?: string | null;
  useLlm?: boolean;
  persist?: boolean;
  force?: boolean;
  dbChunkSize?: number;
  workers?: number;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
  knownTotal?: number;
};

export type RunModSkipDetectPipelineHandlers = {
  onProgress?: (progress: SkipDetectPipelineProgress) => void;
  collectCandidate?: (candidate: LlmSkipDetectCandidate) => void;
};

export type SkipDetectPipelineSummary = {
  done: number;
  candidateCount: number;
  markedCount: number;
};

export type ChunkPersistJob = {
  scannedIds: number[];
  candidates: LlmSkipDetectCandidate[];
};
