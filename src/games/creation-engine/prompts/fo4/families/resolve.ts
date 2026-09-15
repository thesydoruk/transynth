import type { LlmPromptFamily } from '../../../../../llm/promptFamily';

/**
 * Which Fallout 4 prompt a record's text belongs to.
 *
 * Fallout 4 is the only title with per-family prompts: its dialogue, item
 * names, terminal prose, quest text, MCM options and character-creation labels
 * each need a different voice, and one prompt covering all of them produced
 * visibly worse output. Every other title uses a single prompt.
 */
const DIALOG_GRUPS = new Set(['INFO']);
const PROSE_GRUPS = new Set(['BOOK', 'NOTE', 'TERM']);
const QUEST_GRUPS = new Set(['QUST', 'MESG', 'DIAL']);
const MCM_GRUPS = new Set(['MCM']);
const FACE_GRUPS = new Set(['RACE', 'FMRN', 'MPPN', 'TTGP']);

const norm = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

export const resolveFo4PromptFamily = (
  grup: string | null | undefined,
  field?: string | null,
): LlmPromptFamily => {
  const g = norm(grup);
  const f = norm(field);
  if (DIALOG_GRUPS.has(g) || f === 'NAM1' || f === 'RNAM') return 'dialog';
  if (PROSE_GRUPS.has(g)) return 'prose';
  if (QUEST_GRUPS.has(g)) return 'quest';
  if (MCM_GRUPS.has(g)) return 'mcm';
  if (FACE_GRUPS.has(g)) return 'face';
  return 'item';
};
