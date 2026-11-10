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
  /** The folder's main plugin (see `pickPrimaryPlugin`). */
  pluginStem: string | null;
  pluginFileName: string | null;
  /** Every plugin the folder ships, sorted; more than one becomes one mod each. */
  plugins?: string[];
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
  /** Why the server refused the unit's upload (nothing it can import). */
  rejected?: string | null;
  /** Every job the upload registered, one per plugin; the main one is `existingJobId`. */
  jobs?: Array<{ plugin: string | null; jobId: number }>;
  /** For a skipped unit: every mod its jobs imported into. */
  existingModIds?: number[];
  pluginStem: string | null;
  pluginFileName: string | null;
  plugins?: string[];
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

export type VortexAgentState =
  | 'idle'
  | 'scanning'
  | 'uploading'
  | 'waiting-server'
  | 'delivering'
  | 'settling'
  | 'error';

/** What the resident agent reports on every tick (`POST /api/vortex/agent/heartbeat`). */
export type VortexAgentHeartbeat = {
  game: GameId;
  groupKey: string;
  label: string;
  stagingPath: string;
  gameDir: string;
  /** The machine the agent runs on, usually its hostname. */
  agentKey: string;
  agentVersion: string | null;
  state: VortexAgentState;
  pollSec: number;
  pending: { units: number; orderChanged: boolean; settleUntil: string | null } | null;
  lastSyncAt: string | null;
  lastRunId: number | null;
  lastError: string | null;
  delivered: { archiveId: number; fileName: string; at: string } | null;
};

/** A video of one of the group's mods whose file the agent has not uploaded yet. */
export type VideoUploadTask = {
  videoId: number;
  modId: number;
  fileName: string;
  /** sha1 of the video file: how the agent finds it in its inventory. */
  fingerprint: string;
};

/** The newest finished langpack of a group, for the agent to deliver into Vortex. */
export type VortexLatestLangpack = {
  archiveId: number;
  runId: number;
  fileName: string;
  byteSize: number | null;
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
    plugins?: string[];
    sourceFolder: string | null;
    nexusModId: number | null;
    nexusModName: string | null;
    contentHash: string;
  }>;
};
