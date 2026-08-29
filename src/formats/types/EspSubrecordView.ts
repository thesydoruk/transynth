/**
 * A single subrecord rendered for display in the ESP explorer.
 */
export interface EspSubrecordView {
  /** 4-char subrecord type, e.g. "FULL" or "EDID". */
  sig: string;
  /** Original uncompressed byte count. */
  size: number;
  /** Up to 48 bytes encoded as uppercase space-separated hex pairs. */
  hexPreview: string;
  /** Best-effort UTF-8 decode of the data; null when the data is binary. */
  textHint: string | null;
}
