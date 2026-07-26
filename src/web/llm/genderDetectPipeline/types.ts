import type { GenderDetectRecordRow } from '../../data/queries/narratorGender';
import type { LlmNarratorGenderResult } from '../../../llm/narratorGenderDetect';

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
  gender: import('../../../dialog/narratorGender').NarratorGender;
  source: import('../../../dialog/narratorGender').NarratorGenderSource;
  llmResult?: LlmNarratorGenderResult;
};

export type ChunkPersistJob = {
  scannedIds: number[];
  results: GenderDetectChunkResult[];
};

export type { GenderDetectRecordRow };
