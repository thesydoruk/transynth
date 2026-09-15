import type { LlmVerifyVerdict } from '../../../../src/llm/verifyTranslate';
import type { DialogParticipantsRow } from '../../../../src/web/data/queries/dialogs';
import type { LlmPromptFamily } from '../../../../src/llm/promptFamily';
import type { DialogSceneContext } from '../../../../src/llm/dialogScene';

export type LlmVerifyIssue = {
  stringId: number;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  edid: string | null;
  verdict: Exclude<LlmVerifyVerdict, 'ok'>;
  reason: string;
  confidence: number;
  suggestion: string | null;
  /** Set when a fix was attempted but rejected by {@link validateVerifySuggestion}. */
  fixRejected?: string | null;
  /** Full mismatch — translation will be replaced by a fresh translate of source. */
  rewriteFromSource?: boolean;
  /** No deterministic check backs this — the model alone objected. */
  advisory?: boolean;
};

/** One row in the auto-approve action log streamed during verification. */
export type LlmVerifyActionLogEntry = {
  stringId: number;
  edid: string | null;
  path: string | null;
  signature: string | null;
  source: string;
  action: 'approved' | 'fixed' | 'issue';
  detail?: string | null;
};

export type LlmVerifyJobStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type LlmVerifyJobSnapshot = {
  jobId: number;
  modId: number;
  status: LlmVerifyJobStatus;
  done: number;
  total: number;
  /** Strings auto-confirmed (promoted to 'reviewed') because they passed with no issues. */
  approved: number;
  /** Strings auto-corrected from LLM suggestions (incorrect always; suspicious when enabled). */
  fixed: number;
  issues: LlmVerifyIssue[];
  actionLog: LlmVerifyActionLogEntry[];
  error: string | null;
};

export type LlmVerifyProgressEvent =
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
    }
  | {
      type: 'cancelled';
      done: number;
      total: number;
      approved: number;
      fixed: number;
    }
  | { type: 'error'; error: string };

export type VerifyStringRow = DialogParticipantsRow & {
  string_id: number;
  source: string;
  translation: string;
  text_norm: string | null;
  text_norm_nopunct: string | null;
  signature: string | null;
  path: string | null;
  edid: string | null;
  context: string | null;
  /** Narrator gender of the record, for text that is narration rather than dialog. */
  narrator_gender: string | null;
  /** How that narrator gender was arrived at — inferred, or set by a person. */
  narrator_gender_source: string | null;
  narrator_gender_override: string | null;
  /** How many times this row has already been written over. */
  rewrite_count: number;
  /** Wordings this row has already had and moved on from. */
  prior_texts: string[];
  promptFamily?: LlmPromptFamily;
  dialogScene?: DialogSceneContext;
};

export type VerifyLlmWorkUnit = {
  page: number;
  chunk: VerifyStringRow[];
};
