import type { StringsType } from '../../../formats/types/StringsType';
import type { EspStringRow } from '../../../formats/esp';

export type StringsPackFile = {
  filePath: string;
  stem: string;
  locale: string;
  type: StringsType;
};

/** One import candidate: all orphan strings files for a single plugin stem. */
export type StringsPackCandidate = {
  /** Plugin stem from file names, e.g. `fallout4`. */
  stem: string;
  packRoot: string;
  stringsDir: string;
  files: StringsPackFile[];
};

export type LstringEspIndex = Map<StringsType, Map<number, EspStringRow[]>>;

export type StringsPackImportResult = {
  modId: number;
  modName: string;
  imported: number;
  skipped: boolean;
  locales: string[];
  stem: string;
  pluginPath: string;
  mappedEntries: number;
  unmappedEntries: number;
};

export type StringsPackImportOptions = {
  force?: boolean;
  /** Directories searched for `{stem}.esp/.esm/.esl` (e.g. game Data folder). */
  pluginSearchDirs?: string[];
};
