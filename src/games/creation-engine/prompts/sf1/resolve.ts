import type { LlmPromptFamily } from '../../../../llm/promptFamily';

/**
 * Which kind of text a Starfield record holds.
 *
 * The player has no voice: a line the player says is an ordinary `INFO`
 * response, so dialogue is everything under `INFO`. Terminals are `TMLM` menus
 * (`TERM` is the device), slates are `BOOK`, and loading-screen tips are whole
 * sentences that read like the slates do.
 */
const DIALOG_GRUPS = new Set(['INFO', 'VIDEO']);
const PROSE_GRUPS = new Set(['BOOK', 'TMLM', 'TERM', 'LSCR']);
const QUEST_GRUPS = new Set(['QUST', 'MESG', 'DIAL']);
const FACE_GRUPS = new Set(['RACE', 'HDPT']);

const norm = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

export const resolveSf1PromptFamily = (
  grup: string | null | undefined,
  field?: string | null,
): LlmPromptFamily => {
  const g = norm(grup);
  const f = norm(field);
  if (DIALOG_GRUPS.has(g) || f === 'NAM1' || f === 'RNAM') return 'dialog';
  if (PROSE_GRUPS.has(g)) return 'prose';
  if (QUEST_GRUPS.has(g)) return 'quest';
  if (FACE_GRUPS.has(g)) return 'face';
  return 'item';
};
