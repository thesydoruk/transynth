/**
 * FO4/Skyrim SCEN action kinds (ANAM uint16), including FO4-only types 3–6.
 */
export type SceneActionKind =
  | 'dialogue'
  | 'package'
  | 'timer'
  | 'player_dialogue'
  | 'start_scene'
  | 'npc_response'
  | 'radio';

/**
 * One action extracted from a SCEN record — dialogue, timer, package, or FO4 extras.
 */
export interface SceneAction {
  actionType: SceneActionKind;
  /** Quest alias index of the actor (-2 = player). */
  aliasId: number;
  /** Primary DIAL topic (DATA), else the first player/NPC response topic. */
  topicFormId: string | null;
  /** Every DIAL this action references (DATA plus FO4 response slots). */
  topicFormIds: string[];
  /** Scene phase ordinal — determines dialog ordering within the scene. */
  startPhase: number;
  /** Last phase this action spans. */
  endPhase: number;
  /** Timer minimum seconds (`TNAM`), when present. */
  timerMinSeconds: number | null;
  /** Timer maximum seconds (second `SNAM` float), when present. */
  timerMaxSeconds: number | null;
  /** Dialogue looping minimum (`DMIN`). */
  loopMin: number | null;
  /** Dialogue looping maximum (`DMAX`). */
  loopMax: number | null;
  /** Action `FNAM` flags. */
  flags: number;
  /** First `LCEP` start-scene FormID, when this action chains another scene. */
  startSceneFormId: string | null;
}
