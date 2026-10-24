/**
 * Shapes of a whole-corpus review: batches an editor (human or agent) reads,
 * and the fixes they write back. The format is documented for editors in
 * `.claude/skills/corpus-review/batch-format.md`.
 */
import type { LlmPromptFamily } from '../llm/promptFamily';

/** One translatable line as the editor sees it. */
export type ReviewLine = {
  /** Source string id — what a fix names. */
  id: number;
  /** `response` / `prompt` for dialogue, the field name (FULL, DESC…) otherwise. */
  kind: string;
  src: string;
  tr: string;
  ctx?: string;
  speaker?: string;
  speaker_gender?: string;
  addressee?: string;
  addressee_gender?: string;
  /** Conditional alternative of one scene phase, "2/3". */
  variant?: string;
  branch_depth?: number;
  voice_variant?: number;
  sig?: string;
  field?: string;
  edid?: string;
  narrator_gender?: string;
  /** Shown for context; belongs to a neighbouring batch or is already canon. Never edited. */
  context_only?: true;
  qa_hints?: string[];
};

/** Lines that belong together: a scene, a topic tree, a terminal, a series of items. */
export type ReviewUnit = {
  unit_id: string;
  kind: 'conversation' | 'branch' | 'topic' | 'loose' | 'record' | 'group';
  label?: string;
  timing_sensitive?: boolean;
  lines: ReviewLine[];
};

export type ReviewBatch = {
  batch_id: string;
  mod: string;
  mod_id: number;
  /** Game id of the mod, so batches can be checked without the database. */
  game: string;
  family: LlmPromptFamily;
  /** Canonical display names the batch mentions, EN → target. */
  names: Record<string, string>;
  units: ReviewUnit[];
};

/** One edit an editor proposes. */
export type ReviewFix = {
  id: number;
  old: string;
  new: string;
  reason?: string;
  note?: string;
};

export type ReviewFixFile = {
  batch_id: string;
  reviewed?: number;
  fixes: ReviewFix[];
  notes?: string[];
};
