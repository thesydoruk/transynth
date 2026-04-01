import type { SceneAction } from './SceneAction.js';

/**
 * Parsed SCEN record containing an ordered sequence of dialog actions.
 */
export interface SceneRecord {
  /** FormID of the SCEN record (8-char hex). */
  formId: string;
  /** Editor ID (EDID) of the scene. */
  edid: string;
  /** Quest FormID that owns this scene (from QNAM, 8-char hex, may be null). */
  questFormId: string | null;
  /** Ordered dialog actions extracted from the scene phases. */
  actions: SceneAction[];
}
