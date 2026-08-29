/**
 * Quest / branch ownership of one DIAL topic (from DIAL\QNAM and DIAL\BNAM).
 */
export interface DialOwnership {
  /** FormID of the DIAL record (8-char hex). */
  formId: string;
  /** Owning QUST FormID from QNAM, when present. */
  questFormId: string | null;
  /** Owning DLBR FormID from BNAM, when present. */
  branchFormId: string | null;
}
