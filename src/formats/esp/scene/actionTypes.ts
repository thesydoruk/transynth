import type { SceneAction, SceneActionKind } from '../../types';

// ANAM type → kind and the topic subrecords per action live in the title's
// record layout (`../recordLayout.ts`); Fallout 4 and Starfield number them differently.

/** FNAM bit 16 — action loops for DMIN/DMAX seconds instead of one spoken line. */
const SCENE_ACTION_LOOPING_FLAG = 0x0001_0000;

const TIMING_KINDS = new Set<SceneActionKind>(['package', 'timer', 'start_scene', 'radio']);

const hasDuration = (value: number | null): boolean => value != null && Number.isFinite(value);

/**
 * True when this action can desync from a new `.fuz` length.
 *
 * Dialogue / player / NPC-response actions wait for audio unless they loop or
 * carry an explicit timer. Package, timer, start-scene, and radio do not.
 */
export const isTimingSensitiveAction = (action: SceneAction): boolean => {
  if (TIMING_KINDS.has(action.actionType)) return true;
  if ((action.flags & SCENE_ACTION_LOOPING_FLAG) !== 0) return true;
  return (
    hasDuration(action.timerMinSeconds) ||
    hasDuration(action.timerMaxSeconds) ||
    hasDuration(action.loopMin) ||
    hasDuration(action.loopMax)
  );
};

/** True when any action in the scene is pinned to authored seconds or choreography. */
export const sceneHasTimingConstraint = (actions: readonly SceneAction[]): boolean =>
  actions.some(isTimingSensitiveAction);
