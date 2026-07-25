/**
 * Parsed DLBR (dialog branch) record — a CK grouping of DIAL topics under a quest.
 */
export interface BranchRecord {
  /** FormID of the DLBR record (8-char hex). */
  formId: string;
  /** Editor ID (EDID). */
  edid: string;
  /** Parent QUST FormID from QNAM, when present. */
  questFormId: string | null;
  /** Starting DIAL topic FormID from SNAM, when present. */
  startTopicFormId: string | null;
}
