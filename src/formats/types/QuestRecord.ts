/**
 * Parsed QUST skeleton used to label conversations and stage context.
 */
export interface QuestRecord {
  /** FormID of the QUST record (8-char hex). */
  formId: string;
  /** Editor ID (EDID). */
  edid: string;
  /** Display name from FULL when the plugin stores inline text. */
  name: string | null;
  /** Quest stage indices (INDX), unique and sorted ascending. */
  stages: number[];
}
