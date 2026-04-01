/**
 * Summary of one top-level GRUP in an ESP plugin.
 */
export interface EspGrupInfo {
  /** 4-char record type that identifies this group, e.g. "ARMO" or "INFO". */
  signature: string;
  /** Total number of non-GRUP records nested anywhere inside this group. */
  recordCount: number;
}
