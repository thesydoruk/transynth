import type { SceneAction, SceneActionKind } from '../../types';

/** ANAM uint16 → kind. Types 3–6 exist only in Fallout 4. */
export const SCENE_ACTION_KIND_BY_CODE: Record<number, SceneActionKind> = {
  0: 'dialogue',
  1: 'package',
  2: 'timer',
  3: 'player_dialogue',
  4: 'start_scene',
  5: 'npc_response',
  6: 'radio',
};

/** DIAL slots on FO4 player-dialogue / NPC-response actions, plus DATA. */
export const SCENE_TOPIC_SUBRECORDS = new Set([
  'DATA',
  'PTOP',
  'NTOP',
  'NETO',
  'QTOP',
  'NPOT',
  'NNGT',
  'NNUT',
  'NQUT',
]);

/** FNAM bit 16 — action loops for DMIN/DMAX seconds instead of one spoken line. */
export const SCENE_ACTION_LOOPING_FLAG = 0x0001_0000;

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
