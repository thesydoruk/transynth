import type { EspSubrecordView } from './EspSubrecordView.js';

/**
 * A single ESP record rendered for display in the explorer.
 */
export interface EspRecordView {
  /** FormID as 8-char uppercase hex string, e.g. "0001A2B3". */
  formId: string;
  /** 4-char record type, e.g. "ARMO". */
  signature: string;
  /** Raw flags field encoded as 8-char uppercase hex. */
  flagsHex: string;
  /** True if this record was stored in compressed (zlib) form. */
  compressed: boolean;
  /** Editor ID from EDID subrecord, or empty string if absent. */
  edid: string;
  /** All subrecords (up to 64) with preview data. */
  subrecords: EspSubrecordView[];
}
