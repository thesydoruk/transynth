/**
 * Non-localized ESP patch descriptor.
 */
export interface EspPatch {
  /** 8-char uppercase hex FormID, e.g. "0001A2B3". */
  formId: string;
  /** 4-char subrecord signature, e.g. "FULL". */
  subrecord: string;
  /**
   * Text this patch was imported from, used to pick the right occurrence when a
   * record repeats one signature (TERM menu items, QUST objectives, INFO responses).
   */
  oldText: string;
  /** Zero-based position among the record's strings sharing this signature. */
  occurrence: number;
  /** Replacement UTF-8 text (without trailing NUL). */
  newText: string;
}
