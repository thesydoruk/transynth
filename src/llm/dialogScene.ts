/** One spoken turn in a scene / topic window sent to the dialog prompt. */
export type DialogSceneTurn = {
  id: number | null;
  kind: 'prompt' | 'response';
  speaker: string | null;
  source: string;
  translation?: string | null;
  variantIndex?: number;
  variantCount?: number;
  translate: boolean;
};

export type DialogSceneContext = {
  questEdid?: string | null;
  sceneEdid?: string | null;
  timingSensitive?: boolean;
  turns: DialogSceneTurn[];
};

const DEFAULT_MAX_TARGETS = 28;
const DEFAULT_NEIGHBORS = 4;

/**
 * Split a long scene so each window has at most `maxTargets` lines to translate,
 * plus neighbor turns for context. Short scenes stay in one window.
 */
export const windowDialogSceneTurns = (
  turns: DialogSceneTurn[],
  opts?: { maxTargets?: number; neighbors?: number },
): DialogSceneTurn[][] => {
  const maxTargets = opts?.maxTargets ?? DEFAULT_MAX_TARGETS;
  const neighbors = opts?.neighbors ?? DEFAULT_NEIGHBORS;
  const targetIndexes = turns
    .map((turn, index) => (turn.translate && turn.id != null ? index : -1))
    .filter((index) => index >= 0);
  if (targetIndexes.length === 0) return [];
  if (targetIndexes.length <= maxTargets) return [turns];

  const windows: DialogSceneTurn[][] = [];
  for (let i = 0; i < targetIndexes.length; i += maxTargets) {
    const slice = targetIndexes.slice(i, i + maxTargets);
    const from = Math.max(0, slice[0]! - neighbors);
    const to = Math.min(turns.length, slice[slice.length - 1]! + neighbors + 1);
    const targetSet = new Set(slice);
    windows.push(
      turns.slice(from, to).map((turn, offset) => ({
        ...turn,
        translate: targetSet.has(from + offset) && turn.translate,
      })),
    );
  }
  return windows;
};

export const dialogScenePayload = (scene: DialogSceneContext): object => ({
  quest: scene.questEdid ?? null,
  scene: scene.sceneEdid ?? null,
  timing_sensitive: scene.timingSensitive === true,
  turns: scene.turns.map((turn) => ({
    id: turn.id,
    kind: turn.kind,
    speaker: turn.speaker,
    source: turn.source,
    ...(turn.translation ? { translation: turn.translation } : {}),
    ...(turn.variantCount && turn.variantCount > 1
      ? { variant: `${turn.variantIndex ?? 1}/${turn.variantCount}` }
      : {}),
    role: turn.translate ? 'translate' : 'neighbor',
  })),
});
