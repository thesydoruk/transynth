/**
 * The agent's page reads one JSON object: what the agent is, what it is doing,
 * what it last did and what it last wrote into its journal. The CLI token is
 * never part of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import type { VortexAgentState } from '../types';
import type { AgentConfig } from './config';
import type { AgentControl, AgentScanSummary } from './control';
import { readJournalTail, type AgentState } from './state';

export type AgentStatusSource = {
  config: AgentConfig;
  configPath: string;
  journalPath: string;
  agentVersion: string;
  control: AgentControl;
  view: () => { state: AgentState; agentState: VortexAgentState; settleUntil: number | null };
};

export type AgentStatus = {
  version: string;
  machine: string;
  game: string;
  now: string;
  /** The loop's phase, or what the page asked for on top of it. */
  state: VortexAgentState | 'paused' | 'stopping';
  paused: boolean;
  syncRequested: boolean;
  activity: { text: string; done: number | null; total: number | null } | null;
  server: {
    api: string;
    pageUrl: string;
    heartbeatAt: string | null;
    ok: boolean | null;
    error: string | null;
  };
  settleUntil: string | null;
  retryAfter: string | null;
  failures: number;
  lastError: string | null;
  lastSyncAt: string | null;
  nextFullScanAt: string | null;
  lastRunId: number | null;
  scan: AgentScanSummary | null;
  rejected: string[];
  delivered: { archiveId: number; fileName: string; at: string } | null;
  latestLangpack: { archiveId: number; fileName: string } | null;
  paths: { staging: string; gameDir: string; downloads: string; config: string; journal: string };
  settings: Pick<
    AgentConfig,
    'pollSec' | 'settleSec' | 'fullScanEveryMin' | 'autoStages' | 'deliverLangpack' | 'videos'
  >;
  journal: Array<Record<string, unknown>>;
};

const fileSize = (file: string): number | null => {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
};

export const buildAgentStatus = (src: AgentStatusSource, now = Date.now()): AgentStatus => {
  const { config, control } = src;
  const { state, agentState, settleUntil } = src.view();
  const busy = agentState !== 'idle' && agentState !== 'settling' && agentState !== 'error';
  const activity = control.activity;
  const shown: AgentStatus['state'] = control.stopping
    ? 'stopping'
    : control.paused && !busy
      ? 'paused'
      : agentState;
  return {
    version: src.agentVersion,
    machine: os.hostname(),
    game: config.game,
    now: new Date(now).toISOString(),
    state: shown,
    paused: control.paused,
    syncRequested: control.wants('sync'),
    activity: activity
      ? {
          text: activity.text,
          done: activity.file ? fileSize(activity.file) : null,
          total: activity.total ?? null,
        }
      : null,
    server: {
      api: config.api,
      pageUrl: `${config.api}/games/${config.game}/vortex`,
      heartbeatAt: control.heartbeat.at,
      ok: control.heartbeat.ok,
      error: control.heartbeat.error,
    },
    settleUntil:
      settleUntil != null && settleUntil > now ? new Date(settleUntil).toISOString() : null,
    retryAfter: state.retryAfter && Date.parse(state.retryAfter) > now ? state.retryAfter : null,
    failures: state.failures,
    lastError: state.lastError,
    lastSyncAt: state.lastSyncAt,
    nextFullScanAt: state.lastFullScanAt
      ? new Date(Date.parse(state.lastFullScanAt) + config.fullScanEveryMin * 60_000).toISOString()
      : null,
    lastRunId: state.lastRunId,
    scan: control.scan,
    rejected: control.rejected,
    delivered:
      state.deliveredArchiveId != null
        ? {
            archiveId: state.deliveredArchiveId,
            fileName: state.deliveredFileName ?? '',
            at: state.deliveredAt ?? '',
          }
        : null,
    latestLangpack: control.latestLangpack
      ? { archiveId: control.latestLangpack.archiveId, fileName: control.latestLangpack.fileName }
      : null,
    paths: {
      staging: config.stagingPath,
      gameDir: config.gameDir,
      downloads: config.downloadsDir,
      config: src.configPath,
      journal: src.journalPath,
    },
    settings: {
      pollSec: config.pollSec,
      settleSec: config.settleSec,
      fullScanEveryMin: config.fullScanEveryMin,
      autoStages: config.autoStages,
      deliverLangpack: config.deliverLangpack,
      videos: config.videos,
    },
    journal: readJournalTail(src.journalPath),
  };
};
