import { MOD_CONTENT_KINDS, type ModContentKind } from '../../games/contract';
import { gamePlugin, resolveGameId } from '../../games/registry';

export const isModContentKind = (value: unknown): value is ModContentKind =>
  typeof value === 'string' && (MOD_CONTENT_KINDS as readonly string[]).includes(value);

/** A stored `content_kind` wins (manual); otherwise the game plugin classifies the anchor file. */
export const resolveModContentKind = (mod: {
  game: string | null;
  abs_path: string | null;
  content_kind: string | null;
}): { kind: ModContentKind; manual: boolean } => {
  if (isModContentKind(mod.content_kind)) return { kind: mod.content_kind, manual: true };
  const basename = mod.abs_path?.split(/[\\/]/).pop();
  if (!basename) return { kind: 'mod', manual: false };
  const adapter = gamePlugin(resolveGameId(mod.game)).content;
  return { kind: adapter?.classify(basename) ?? 'mod', manual: false };
};
