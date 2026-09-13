import { resolveGameType } from './prompts/resolveGame';
import type { GameType } from '../types';

/** FO4 text families — one prompt per kind of string, not per raw GRUP. */
export type LlmPromptFamily = 'dialog' | 'item' | 'prose' | 'quest' | 'mcm' | 'face' | 'default';

const DIALOG_GRUPS = new Set(['INFO']);
const PROSE_GRUPS = new Set(['BOOK', 'NOTE', 'TERM']);
const QUEST_GRUPS = new Set(['QUST', 'MESG', 'DIAL']);
const MCM_GRUPS = new Set(['MCM']);
const FACE_GRUPS = new Set(['RACE', 'FMRN', 'MPPN', 'TTGP']);

const norm = (value: string | null | undefined): string => (value ?? '').trim().toUpperCase();

/** Map one FO4 record to a prompt family. */
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

export const resolvePromptFamily = (
  game: GameType | string | null | undefined,
  grup: string | null | undefined,
  field?: string | null,
): LlmPromptFamily => {
  if (resolveGameType(game) !== 'fo4') return 'default';
  return resolveFo4PromptFamily(grup, field);
};

/** Family of a homogeneous batch; mixed batches should be split first. */
export const resolveBatchPromptFamily = (
  game: GameType | string | null | undefined,
  items: ReadonlyArray<{ grup?: string | null; field?: string | null }>,
  explicit?: LlmPromptFamily | null,
): LlmPromptFamily => {
  if (explicit) return explicit;
  if (resolveGameType(game) !== 'fo4') return 'default';
  if (items.length === 0) return 'item';
  const families = new Set(items.map((item) => resolveFo4PromptFamily(item.grup, item.field)));
  if (families.size === 1) return [...families][0]!;
  return 'item';
};

export const partitionByPromptFamily = <T extends { grup?: string | null; field?: string | null }>(
  game: GameType | string | null | undefined,
  items: readonly T[],
): Map<LlmPromptFamily, T[]> => {
  const buckets = new Map<LlmPromptFamily, T[]>();
  for (const item of items) {
    const family = resolvePromptFamily(game, item.grup, item.field);
    const list = buckets.get(family);
    if (list) list.push(item);
    else buckets.set(family, [item]);
  }
  return buckets;
};
