/**
 * A single extracted translatable string location within an ESP/ESM/ESL plugin.
 */
export interface EspStringRow {
  /** FormID as hex string (8 uppercase chars), e.g. "0001A2B3". */
  formId: string;
  /** 4-char record type, e.g. "ARMO". */
  signature: string;
  /** Editor ID (EDID subrecord), empty if not present. */
  edid: string;
  /** Subrecord path, e.g. "FULL" or "INFO\\NAM1". */
  path: string;
  /** For localized: uint32 lstring ID; for non-localized: the actual text. */
  text: string;
  /** True if this plugin is localized (text is an lstring ID, not real text). */
  isLstringId: boolean;
  /** FormID of the actor who speaks this INFO row (INFO records only). */
  speakerFormId?: string;
  /** Parent DIAL FormID for INFO rows when extracted from a topic-children GRUP. */
  dialogTopicFormId?: string;
  /** Previous INFO FormID from PNAM subrecord when present. */
  previousInfoFormId?: string;
}
