import type { LlmDialogParticipants } from './dialogParticipants';
import type { LlmGlossaryEntry, LlmReferenceExample } from './translate';
import type { GameId } from '../types';
import type { LlmPromptFamily } from './promptFamily';
import type { DialogSceneContext } from './dialogScene';
import { parseLlmItemId } from './jsonParse';
import type { LlmSlotHint, LlmTextPart, LlmTextSlot } from './textParts';

export type LlmVerifyVerdict = 'ok' | 'suspicious' | 'incorrect';

/** One source/translation pair sent to the verifier. */
export interface LlmVerifyItem extends LlmDialogParticipants {
  id: number;
  source: string;
  translation: string;
  parts?: LlmTextPart[];
  translation_parts?: LlmTextPart[];
  slots?: LlmSlotHint[];
  restoreSlots?: LlmTextSlot[];
  sourceParts?: LlmTextPart[];
  grup: string | null;
  edid: string | null;
  field: string | null;
  context: string | null;
  reference_examples?: LlmReferenceExample[];
}

/**
 * A defect the system proved for itself, independent of the model's opinion.
 *
 * Measured on the production corpus: findings backed by one of these recur on
 * 96% of re-checks, while the model's unaided judgement of calque, tone or
 * register flips on a third of the rows it passed last time. Only a proven
 * defect is allowed to block approval; the rest is advice for a human.
 */
export type VerifyDefectKind =
  | 'protected_token_mismatch'
  | 'markup_broken'
  | 'gender_leak'
  | 'corrupted_translation'
  | 'full_translation_mismatch';

/** Per-item audit result returned by the LLM. */
export interface LlmVerifyItemResult {
  id: number;
  verdict: LlmVerifyVerdict;
  reason: string;
  confidence: number;
  /** Improved translation when verdict is suspicious or incorrect; null for ok. */
  suggestion: string | null;
  /** Deterministic findings on this row; empty when only the model objected. */
  defects?: VerifyDefectKind[];
}

/**
 * Whether this result may block approval.
 *
 * `incorrect` is the model's strongest claim and is rare and mostly real, so it
 * blocks. A bare `suspicious` is advice: it is recorded against the row and
 * shown in the editor, but it does not hold the row out of review for ever.
 */
export const isBlockingVerifyResult = (result: LlmVerifyItemResult): boolean =>
  result.verdict === 'incorrect' || (result.defects?.length ?? 0) > 0;

export interface LlmVerifyOptions {
  items: LlmVerifyItem[];
  model: string;
  srcLang: string;
  targetLang: string;
  game?: GameId | string | null;
  modName?: string | null;
  /** Per-batch glossary terms (same filtering as translate). */
  glossary?: LlmGlossaryEntry[];
  promptFamily?: LlmPromptFamily;
  dialogScene?: DialogSceneContext;
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
