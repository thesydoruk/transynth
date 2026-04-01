/**
 * Non-localized ESP patch descriptor.
 */
export interface EspPatch {
  /** 8-char uppercase hex FormID, e.g. "0001A2B3". */
  formId: string;
  /** 4-char subrecord signature, e.g. "FULL". */
  subrecord: string;
  /** Replacement UTF-8 text (without trailing NUL). */
  newText: string;
}
