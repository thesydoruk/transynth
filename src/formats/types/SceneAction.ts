/**
 * One dialog action extracted from a SCEN record.
 */
export interface SceneAction {
  /** Action type (0 = dialogue, 1 = package, 2 = timer); only dialogue is kept. */
  actionType: number;
  /** Quest alias index of the speaking actor (-2 = player). */
  aliasId: number;
  /** DIAL topic FormID (8-char hex) referenced by this action. */
  topicFormId: string;
  /** Scene phase ordinal — determines dialog ordering within the scene. */
  startPhase: number;
  /** Last phase this action spans. */
  endPhase: number;
}
