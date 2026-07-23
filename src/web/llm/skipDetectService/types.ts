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

export type LlmSkipDetectJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmSkipDetectJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmSkipDetectJobStatus;
  done: number;
  total: number;
  candidates: LlmSkipDetectCandidate[];
  /** Rows written to DB as skip when {@link runLlmSkipDetectJob} `persist` is enabled. */
  markedCount: number;
  error: string | null;
};

export type ScanStringRow = {
  string_id: number;
  source: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  context: string | null;
};

export type SkipDetectWorkUnit = {
  page: number;
  chunk: ScanStringRow[];
};

export type LlmSkipDetectProgressEvent =
  | { type: 'started'; jobId: number; total: number; useLlm: boolean; persist: boolean }
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
      markedCount: number;
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      candidates: LlmSkipDetectCandidate[];
      markedCount: number;
    }
  | { type: 'error'; error: string };

export type ActiveLlmSkipDetectJob = LlmSkipDetectJobSnapshot & {
  cancel: boolean;
  srcLang: string;
  useLlm: boolean;
  persist: boolean;
  force: boolean;
  /** Aborts in-flight LLM requests the instant Stop is pressed. */
  abort: AbortController;
};
