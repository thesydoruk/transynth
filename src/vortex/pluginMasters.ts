import { readPluginMasterNames } from '../formats/esp';
import { resolveModStoredPath } from '../modStorage';
import type { VortexLangpackModRef } from './exportOrder';

/** TES4 master names of a row's plugin; `[]` when the row has no readable plugin. */
export const readPluginMastersOf = (row: VortexLangpackModRef): string[] => {
  try {
    if (!row.abs_path) return [];
    return readPluginMasterNames(resolveModStoredPath(row.abs_path));
  } catch {
    return [];
  }
};
