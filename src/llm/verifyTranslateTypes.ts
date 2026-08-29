import type { LlmDialogParticipants } from './dialogParticipants';
import type { LlmGlossaryEntry, LlmReferenceExample } from './translate';
import type { GameType } from '../types';
import { parseLlmItemId } from './jsonParse';

export type LlmVerifyVerdict = 'ok' | 'suspicious' | 'incorrect';

/** One source/translation pair sent to the verifier. */
export interface LlmVerifyItem extends LlmDialogParticipants {
  id: number;
  source: string;
  translation: string;
  grup: string | null;
  edid: string | null;
  field: string | null;
  context: string | null;
  reference_examples?: LlmReferenceExample[];
}

/** Per-item audit result returned by the LLM. */
export interface LlmVerifyItemResult {
  id: number;
  verdict: LlmVerifyVerdict;
  reason: string;
  confidence: number;
  /** Improved translation when verdict is suspicious or incorrect; null for ok. */
  suggestion: string | null;
}

export interface LlmVerifyOptions {
  items: LlmVerifyItem[];
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameType | string | null;
  modName?: string | null;
  /** Per-batch glossary terms (same filtering as translate). */
  glossary?: LlmGlossaryEntry[];
  /** Aborts the in-flight LLM request when the owning job is stopped. */
  signal?: AbortSignal;
}

/** Some ids parsed; others missing from the model JSON — caller may persist partial results. */
export class LlmVerifyMissingIdsError extends Error {
  readonly missingIds: readonly number[];
  readonly partialResults: readonly LlmVerifyItemResult[];

  constructor(missingIds: number[], partialResults: LlmVerifyItemResult[]) {
    super(`LLM verify response missing item id=${missingIds[0]}`);
    this.name = 'LlmVerifyMissingIdsError';
    this.missingIds = missingIds;
    this.partialResults = partialResults;
  }
}

export const isLlmVerifyMissingIdsError = (err: unknown): err is LlmVerifyMissingIdsError =>
  err instanceof LlmVerifyMissingIdsError;

/** Accept integer ids returned as JSON numbers or numeric strings. */
export const parseVerifyItemId = (value: unknown): number | null => parseLlmItemId(value);
