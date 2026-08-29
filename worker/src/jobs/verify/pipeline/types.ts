import type { LlmVerifyItem } from '../../../../../src/llm/verifyTranslate';
import type { LlmVerifyIssue, VerifyLlmWorkUnit } from '../queries';
import type { Tx } from '../../../../../src/db';
import type { RagRetrievalOptions } from '../../../../../src/llm/rag';
import type { GlossaryEntryWithRe } from '../../shared/glossaryForLlm';
import type { BatchPersistContext } from './batchPersist';

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
  rag?: import('../../../../../src/llm/rag').RagRetrievalOptions;
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

export type VerifyChunkContext = {
  db: Tx;
  opts: RunModVerifyPipelineOpts;
  model: string;
  glossaryAll: GlossaryEntryWithRe[];
  ragMaxExamples: number;
  ragMinSimilarity: number;
  rag: RagRetrievalOptions;
  fixSuspicious: boolean;
  dryRun: boolean;
  persistCtx: BatchPersistContext;
  shouldCancel?: () => boolean;
  collectIssue?: (issue: LlmVerifyIssue) => void;
};

export type VerifyBatchPersistJob = {
  okStringIds: number[];
  fixes: Array<{ stringId: number; text: string; row: VerifyStringRow }>;
  rewrites: Array<{ item: LlmVerifyItem; row: VerifyStringRow }>;
  issues: LlmVerifyIssue[];
  rowById: Map<number, VerifyStringRow>;
  progressRows: Array<{
    result: Awaited<
      ReturnType<typeof import('../../../../../src/llm/verifyTranslate').verifyTranslationsWithLlm>
    >[number];
    row?: VerifyStringRow;
    issue?: LlmVerifyIssue;
    verdictCounts?: { suspicious?: boolean; incorrect?: boolean; error?: boolean };
  }>;
};
