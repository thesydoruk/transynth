import type { SceneAction } from './SceneAction';

/**
 * Parsed SCEN record: dialogue plus timing/choreography actions.
 */
export interface SceneRecord {
  /** FormID of the SCEN record (8-char hex). */
  formId: string;
  /** Editor ID (EDID) of the scene. */
  edid: string;
  /** Quest FormID that owns this scene (from PNAM, 8-char hex, may be null). */
  questFormId: string | null;
  /** Actions in start-phase order (dialogue, timer, package, FO4 extras). */
  actions: SceneAction[];
}
