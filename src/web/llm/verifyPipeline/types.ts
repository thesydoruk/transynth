import type { LlmVerifyItem } from '../../../llm/verifyTranslate';
import type { LlmVerifyIssue, VerifyLlmWorkUnit } from '../verifyService/queries';

export type VerifyStringRow = VerifyLlmWorkUnit['chunk'][number];

export type VerifyPipelineProgress = {
  done: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
  dbPage: number;
  issue?: LlmVerifyIssue;
  chunkError?: { stringIds: number[]; message: string };
};

export type RunModVerifyPipelineOpts = {
  modId: number;
  srcLang: string;
  targetLang: string;
  modName?: string | null;
  game?: string | null;
  dryRun?: boolean;
  autoApproveVerified?: boolean;
  fixSuspicious?: boolean;
  force?: boolean;
  dbChunkSize?: number;
  rag?: import('../../../llm/rag').RagRetrievalOptions;
  shouldCancel?: () => boolean;
  signal?: AbortSignal;
  /** Skip COUNT(*) when the caller already computed total rows. */
  knownTotal?: number;
};

export type RunModVerifyPipelineHandlers = {
  onProgress?: (progress: VerifyPipelineProgress) => void;
  onActionLog?: (entry: {
    stringId: number;
    edid: string | null;
    path: string | null;
    signature: string | null;
    source: string;
    action: 'approved' | 'fixed' | 'issue';
    detail?: string | null;
  }) => void;
  collectIssue?: (issue: LlmVerifyIssue) => void;
};

export type VerifyPipelineSummary = {
  done: number;
  approved: number;
  fixed: number;
  suspicious: number;
  incorrect: number;
  errors: number;
};

export type VerifyBatchPersistJob = {
  okStringIds: number[];
  fixes: Array<{ stringId: number; text: string; row: VerifyStringRow }>;
  rewrites: Array<{ item: LlmVerifyItem; row: VerifyStringRow }>;
  issues: LlmVerifyIssue[];
  rowById: Map<number, VerifyStringRow>;
  progressRows: Array<{
    result: Awaited<
      ReturnType<typeof import('../../../llm/verifyTranslate').verifyTranslationsWithLlm>
    >[number];
    row?: VerifyStringRow;
    issue?: LlmVerifyIssue;
    verdictCounts?: { suspicious?: boolean; incorrect?: boolean; error?: boolean };
  }>;
};
