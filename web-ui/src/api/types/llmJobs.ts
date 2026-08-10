export type LlmVerifyVerdict = 'suspicious' | 'incorrect';

export type LlmVerifyIssue = {
  stringId: number;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  verdict: LlmVerifyVerdict;
  reason: string;
  confidence: number;
  suggestion: string | null;
};

export type LlmVerifyActionLogEntry = {
  stringId: number;
  edid: string | null;
  path: string | null;
  signature: string | null;
  source: string;
  action: 'approved' | 'fixed' | 'issue';
  detail?: string | null;
};

export type LlmVerifyJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  approved: number;
  fixed: number;
  issues: LlmVerifyIssue[];
  actionLog: LlmVerifyActionLogEntry[];
  error: string | null;
};

export type LlmVerifyStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | {
      type: 'progress';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issue?: LlmVerifyIssue;
      action?: LlmVerifyActionLogEntry;
    }
  | {
      type: 'done';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issues: LlmVerifyIssue[];
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      approved: number;
      fixed: number;
      issues: LlmVerifyIssue[];
    }
  | { type: 'error'; error: string };

export type LlmSkipDetectCandidate = {
  stringId: number;
  source: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  reason: string;
  confidence: number;
  method: 'heuristic' | 'llm' | 'both';
};

export type LlmSkipDetectJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  candidates: LlmSkipDetectCandidate[];
  markedCount?: number;
  error: string | null;
};

export type LlmSkipDetectStreamEvent =
  | { type: 'started'; jobId: number; total: number; useLlm: boolean; persist?: boolean }
  | {
      type: 'progress';
      done: number;
      total: number;
      candidate?: LlmSkipDetectCandidate;
      candidatesBatch?: LlmSkipDetectCandidate[];
      marked?: number;
    }
  | {
      type: 'done';
      done: number;
      total: number;
      candidates: LlmSkipDetectCandidate[];
      markedCount?: number;
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      candidates: LlmSkipDetectCandidate[];
      markedCount?: number;
    }
  | { type: 'error'; error: string };

export type LlmGenderDetectJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  resolvedCount: number;
  error: string | null;
};

export type LlmGenderDetectStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done';
      done: number;
      total: number;
      resolvedCount: number;
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      resolvedCount: number;
    }
  | { type: 'error'; error: string };

export type ModStressPlaceScope = 'all' | 'missing';

export type LlmStressPlaceJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  placedCount: number;
  error: string | null;
};

export type LlmStressPlaceStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; done: number; total: number; placedCount: number }
  | { type: 'cancelled'; done: number; total: number; placedCount: number }
  | { type: 'error'; error: string };

export type LlmTranslateRow = {
  stringId: number;
  source: string;
  translation: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  error: string | null;
};

export type LlmTranslateJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  rows: LlmTranslateRow[];
  error: string | null;
};

export type ModAiJobKind =
  | 'translate'
  | 'verify'
  | 'skip-detect'
  | 'gender-detect'
  | 'stress-place'
  | 'voice';
export type ModTranslateMode = 'tm' | 'llm';

export type ActiveModAiJob = {
  jobId: number;
  modId: number;
  kind: ModAiJobKind;
  done: number;
  total: number;
  status: 'running';
  translateMode?: ModTranslateMode;
  /** Present for character-scoped voice jobs. */
  speakerKey?: string | null;
};

export type ModVoiceGenerateScope = 'all' | 'missing';

export type ModVoiceGenerateJobSnapshot = {
  jobId: number;
  modId: number;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  done: number;
  total: number;
  written: number;
  skipped: number;
  warningCount: number;
  error: string | null;
};

export type ModVoiceGenerateStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done';
      done: number;
      total: number;
      written: number;
      skipped: number;
      warningCount: number;
    }
  | { type: 'cancelled'; done: number; total: number }
  | { type: 'error'; error: string };

export type LlmTranslateStreamEvent =
  | { type: 'started'; jobId: number; total: number }
  | { type: 'progress'; done: number; total: number; row?: LlmTranslateRow }
  | { type: 'done'; done: number; total: number; rows: LlmTranslateRow[] }
  | { type: 'cancelled'; done: number; total: number; rows: LlmTranslateRow[] }
  | { type: 'error'; error: string };
