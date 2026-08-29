import type { GenderDetectRecordRow } from '../../../../../src/web/data/queries/narratorGender';
import type { LlmNarratorGenderResult } from '../../../../../src/llm/narratorGenderDetect';

export type RunModGenderDetectPipelineOpts = {
  modId: number;
  srcLang: string;
  modName?: string | null;
  game?: string | null;
  useLlm: boolean;
  force: boolean;
  dbChunkSize?: number;
  workers?: number;
  knownTotal?: number;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
};

export type GenderDetectPipelineProgress = {
  done: number;
  total: number;
  resolvedCount: number;
  resolvedBatch?: LlmNarratorGenderResult[];
};

export type RunModGenderDetectPipelineHandlers = {
  onProgress?: (progress: GenderDetectPipelineProgress) => void;
};

export type GenderDetectPipelineSummary = {
  done: number;
  resolvedCount: number;
};

export type GenderDetectChunkResult = {
  recordId: number;
  gender: import('../../../../../src/dialog/narratorGender').NarratorGender;
  source: import('../../../../../src/dialog/narratorGender').NarratorGenderSource;
  llmResult?: LlmNarratorGenderResult;
};

export type ChunkPersistJob = {
  results: GenderDetectChunkResult[];
};

export type { GenderDetectRecordRow };
