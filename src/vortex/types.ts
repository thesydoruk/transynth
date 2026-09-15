import type { GameId } from '../types';
import type { VortexChannel } from './stages';

export type VortexUnitChannel = 'mods' | 'game';

export type VortexInventoryFile = {
  absPath: string;
  relPath: string;
};

export type VortexInventoryUnit = {
  unitId: string;
  channel: VortexUnitChannel;
  name: string;
  pluginStem: string | null;
  pluginFileName: string | null;
  sourceFolder: string | null;
  nexusModId: number | null;
  nexusModName: string | null;
  contentHash: string;
  files: VortexInventoryFile[];
};

export type VortexGameReleaseHint = {
  versionLabel: string;
  releaseHash: string;
};

export type VortexInventory = {
  game: GameId;
  stagingPath: string;
  gameDir: string;
  dataDir: string;
  groupKey: string;
  gameRelease: VortexGameReleaseHint;
  units: VortexInventoryUnit[];
};

export type VortexPlanAction = 'upload' | 'skip' | 'update';

export type VortexPlanUnit = {
  unitId: string;
  action: VortexPlanAction;
  channel: VortexUnitChannel;
  name: string;
  contentHash: string;
  scopedFileHash: string;
  existingModId: number | null;
  existingJobId: number | null;
  pluginStem: string | null;
  pluginFileName: string | null;
  sourceFolder: string | null;
  nexusModId: number | null;
  nexusModName: string | null;
};

export type VortexFileWinner = {
  path: string;
  sourceFolder: string;
};

export type VortexExportOrder = {
  plugins: string[];
  enabledPlugins?: string[];
  fileWinners: VortexFileWinner[];
  /** When false, still drop disabled mods but keep alphabetical merge. Default true. */
  applyOrder?: boolean;
};

export type VortexPlanPayload = {
  groupKey: string;
  label: string;
  game: GameId;
  stagingPath: string;
  gameDir: string;
  channel: VortexChannel;
  srcLang: string;
  tgtLang: string;
  gameRelease: VortexGameReleaseHint;
  units: Array<{
    unitId: string;
    channel: VortexUnitChannel;
    name: string;
    pluginStem: string | null;
    pluginFileName: string | null;
    sourceFolder: string | null;
    nexusModId: number | null;
    nexusModName: string | null;
    contentHash: string;
  }>;
};
