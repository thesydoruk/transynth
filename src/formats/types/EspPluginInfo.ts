/**
 * Basic metadata parsed from the TES4 header record.
 */
export interface EspPluginInfo {
  /** Whether this plugin stores translatable text in external string tables. */
  isLocalized: boolean;
  /** Master file names listed in TES4.MAST subrecords. */
  masterFiles: string[];
  /** Plugin author from CNAM. */
  author: string;
  /** Plugin description from SNAM. */
  description: string;
}
