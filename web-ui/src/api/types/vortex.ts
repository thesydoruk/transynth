export type VortexGroup = {
  id: number;
  game: string;
  group_key: string;
  label: string;
  staging_path: string | null;
  game_dir: string | null;
};

export type VortexGameRelease = {
  id: number;
  version_label: string;
  release_hash: string;
  is_current: boolean;
  created_at: string;
};

/** Stages the page may start; import and carry belong to the agent. */
export type VortexStage = 'tm' | 'llm' | 'verify' | 'skip' | 'gender' | 'voice' | 'export';

export type VortexAgentState =
  | 'idle'
  | 'scanning'
  | 'uploading'
  | 'waiting-server'
  | 'delivering'
  | 'settling'
  | 'error';

export type VortexAgent = {
  id: number;
  vortex_group_id: number;
  agent_key: string;
  agent_version: string | null;
  state: VortexAgentState | string;
  state_json: {
    pollSec?: number;
    pending?: { units: number; orderChanged: boolean; settleUntil: string | null } | null;
    lastRunId?: number | null;
    delivered?: { archiveId: number; fileName: string; at: string } | null;
    deliveredVideopack?: { version: string; fileName: string; at: string } | null;
  } | null;
  last_error: string | null;
  last_sync_at: string | null;
  last_seen_at: string;
};

export type VortexModJob = {
  modId: number;
  name: string;
  kind: string;
  jobId: number | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
  done: number;
  total: number;
  error: string | null;
};

export type VortexRun = {
  id: number;
  vortex_group_id: number;
  status: string;
  stage: string | null;
  started_by: string | null;
  current_stage: string | null;
  last_completed_stage: string | null;
  current_mod_id: number | null;
  job_id: number | null;
  export_archive_id: number | null;
  error: string | null;
  created_at?: string;
  updated_at?: string;
};

export type VortexRunStatus = VortexRun & {
  modJobs: VortexModJob[];
  progress: { done: number; total: number };
};

export type VortexLatestLangpack = {
  archiveId: number;
  runId: number;
  fileName: string;
  byteSize: number | null;
};

export type VortexGroupState = {
  group: VortexGroup;
  agent: VortexAgent | null;
  currentRun: VortexRun | null;
  latestLangpack: VortexLatestLangpack | null;
  services: Partial<Record<'llm' | 'embed' | 'tts', boolean>>;
  probedAt: string;
};
