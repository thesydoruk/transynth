import { gamePlugin } from '../games/registry';
import type { GameId } from '../types';

/**
 * Kind of text a string is, when a game splits its prompts by kind.
 *
 * Only Fallout 4 does today; every other game reports `default` and uses one
 * prompt for everything.
 */
export type LlmPromptFamily = 'dialog' | 'item' | 'prose' | 'quest' | 'mcm' | 'face' | 'default';

/** The family of one record, as the game classifies it. */
export const resolvePromptFamily = (
  game: GameId | string | null | undefined,
  grup: string | null | undefined,
  field?: string | null,
): LlmPromptFamily => gamePlugin(game).prompts.resolveFamily?.(grup, field) ?? 'default';

/** Family of a homogeneous batch; mixed batches should be split first. */
export const resolveBatchPromptFamily = (
  game: GameId | string | null | undefined,
  items: ReadonlyArray<{ grup?: string | null; field?: string | null }>,
  explicit?: LlmPromptFamily | null,
): LlmPromptFamily => {
  if (explicit) return explicit;
  const resolveFamily = gamePlugin(game).prompts.resolveFamily;
  if (!resolveFamily) return 'default';
  if (items.length === 0) return 'item';

  const families = new Set(items.map((item) => resolveFamily(item.grup, item.field)));
  return families.size === 1 ? [...families][0]! : 'item';
};

export const partitionByPromptFamily = <T extends { grup?: string | null; field?: string | null }>(
  game: GameId | string | null | undefined,
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
