/**
 * The watch loop: a cheap look at staging every tick, a settle window after a
 * change (Vortex installs step by step, then deploys), one sync when it is
 * quiet, a heartbeat every tick, and the deliveries the heartbeat asks for:
 * the files of new videos up to the server, the langpack (dubbed videos
 * included) down into Vortex's downloads. Errors go to the journal and back
 * off; a new change resets that.
 */
import os from 'node:os';
import path from 'node:path';
import { log } from '../../logger';
import { vortexGroupAnchor, vortexGroupKey, vortexGroupLabel } from '../groupKey';
import type { VortexAgentHeartbeat, VortexAgentState } from '../types';
import type { AgentApi } from './apiClient';
import {
  diffWatchSnapshots,
  readWatchSnapshot,
  watchSignature,
  type WatchSnapshot,
} from './changeDetector';
import { agentDataDir, type AgentConfig } from './config';
import { AgentControl } from './control';
import { loadHashCache, saveHashCache } from './hashCache';
import {
  deliverLangpack,
  langpackFileName,
  looksLikeVortexDownloads,
  shouldDeliver,
} from './langpackDelivery';
import { runSyncCycle } from './syncCycle';
import { AgentVideoSync } from './videoSync';
import {
  appendJournal,
  readAgentState,
  retryDelayMs,
  writeAgentState,
  type AgentState,
} from './state';

export type AgentPaths = { state: string; cache: string; journal: string };

export const defaultAgentPaths = (dir = agentDataDir()): AgentPaths => ({
  state: path.join(dir, 'state.json'),
  cache: path.join(dir, 'hash-cache.json'),
  journal: path.join(dir, 'journal.log'),
});

export type AgentLoopOptions = {
  config: AgentConfig;
  api: AgentApi;
  paths: AgentPaths;
  agentVersion: string;
  /** One tick, sync at once if anything changed, then return. */
  once?: boolean;
  sleep?: (ms: number) => Promise<void>;
  isStopping?: () => boolean;
  /** Commands from the agent's page, and the live facts it shows. */
  control?: AgentControl;
};

export class VortexAgentLoop {
  private state: AgentState;
  private agentState: VortexAgentState = 'idle';
  private pendingSince: WatchSnapshot | null = null;
  private settleUntil: number | null = null;
  private lastWatch: WatchSnapshot | null = null;
  private readonly cache;
  private readonly videos: AgentVideoSync;
  readonly control: AgentControl;

  constructor(private readonly opts: AgentLoopOptions) {
    this.state = readAgentState(opts.paths.state);
    this.cache = loadHashCache(opts.paths.cache);
    this.control = opts.control ?? new AgentControl();
    // A pause is the user's word: it holds across a restart and a reboot.
    this.control.paused = this.control.paused || this.state.paused;
    this.keepPause(this.control.paused);
    this.control.onPauseChange = (paused) => this.keepPause(paused);
    this.videos = new AgentVideoSync({
      config: opts.config,
      api: opts.api,
      cache: this.cache,
      cachePath: opts.paths.cache,
      state: () => this.state,
      journal: (entry) => this.journal(entry),
      onBusy: (busy) => {
        this.agentState = busy ? 'uploading' : 'idle';
      },
      onActivity: (text) => {
        this.control.activity = { text };
      },
    });
  }

  /** What the loop knows right now, for the agent's page. */
  view() {
    return { state: this.state, agentState: this.agentState, settleUntil: this.settleUntil };
  }

  private keepPause(paused: boolean): void {
    if (this.state.paused === paused) return;
    this.state.paused = paused;
    this.save();
    this.journal({ event: 'command', command: paused ? 'pause' : 'resume' });
  }

  private journal(entry: Record<string, unknown>): void {
    appendJournal(this.opts.paths.journal, entry);
  }

  private save(): void {
    writeAgentState(this.opts.paths.state, this.state);
  }

  private heartbeatBody(): VortexAgentHeartbeat {
    const { config } = this.opts;
    const anchor = vortexGroupAnchor(config.stagingPath, config.group);
    return {
      game: config.game,
      groupKey: vortexGroupKey(config.game, anchor),
      label: vortexGroupLabel(anchor, config.game),
      stagingPath: config.stagingPath,
      gameDir: config.gameDir,
      agentKey: os.hostname(),
      agentVersion: this.opts.agentVersion,
      state: this.agentState,
      pollSec: config.pollSec,
      pending: this.pendingSince
        ? {
            units: 0,
            orderChanged:
              this.lastWatch != null && diffWatchSnapshots(this.lastWatch, this.pendingSince).order,
            settleUntil: this.settleUntil ? new Date(this.settleUntil).toISOString() : null,
          }
        : null,
      lastSyncAt: this.state.lastSyncAt,
      lastRunId: this.state.lastRunId,
      lastError: this.state.lastError,
      delivered:
        this.state.deliveredArchiveId != null
          ? {
              archiveId: this.state.deliveredArchiveId,
              fileName: this.state.deliveredFileName ?? '',
              at: this.state.deliveredAt ?? '',
            }
          : null,
    };
  }

  private async heartbeat(): Promise<void> {
    const reply = await this.opts.api.heartbeat(this.heartbeatBody());
    // Another group than the last sync went to (the `group` setting changed):
    // this machine's mods are unknown there until it plans again.
    if (this.state.groupId != null && reply.groupId !== this.state.groupId) {
      this.state.resyncNeeded = true;
      this.journal({ event: 'group-changed', from: this.state.groupId, to: reply.groupId });
    }
    this.state.groupId = reply.groupId;
    this.control.heartbeatResult(null);
    this.control.latestLangpack = reply.latestLangpack;
    if (this.control.paused) return;
    await this.videos.upload(reply.videoUploads);
    if (!this.opts.config.deliverLangpack) return;
    if (!shouldDeliver(reply.latestLangpack, this.state.deliveredArchiveId)) return;
    this.agentState = 'delivering';
    const { config } = this.opts;
    const fileName = langpackFileName(config.game, config.tgtLang, reply.latestLangpack.archiveId);
    this.control.activity = {
      text: `downloading ${fileName}`,
      file: path.join(config.downloadsDir, `${fileName}.part`),
      ...(reply.latestLangpack.byteSize != null ? { total: reply.latestLangpack.byteSize } : {}),
    };
    if (!looksLikeVortexDownloads(config.downloadsDir)) {
      log.warn(`vortex-agent: ${config.downloadsDir} has no Vortex marker file; delivering anyway`);
    }
    const delivered = await deliverLangpack(this.opts.api, {
      latest: reply.latestLangpack,
      downloadsDir: config.downloadsDir,
      game: config.game,
      tgtLang: config.tgtLang,
    });
    this.state.deliveredArchiveId = reply.latestLangpack.archiveId;
    this.state.deliveredFileName = delivered.fileName;
    this.state.deliveredAt = new Date().toISOString();
    this.save();
    this.journal({
      event: 'langpack-delivered',
      ...delivered,
      archiveId: reply.latestLangpack.archiveId,
    });
    log.info(
      `vortex-agent: langpack ${delivered.fileName} ${delivered.skipped ? 'already' : ''} in Vortex downloads`,
    );
    this.agentState = 'idle';
  }

  /** Did staging change, and has it been quiet long enough to sync? */
  private dueForSync(now: number, force = false): boolean {
    const watch = readWatchSnapshot(this.opts.config);
    const changedSinceState = watchSignature(watch) !== this.state.signatures.watch;
    // A failed cycle is retried like a due full scan: the staging folder may
    // look exactly as it did, but the server never finished with it.
    const fullScanDue =
      this.state.resyncNeeded ||
      !this.state.lastFullScanAt ||
      now - Date.parse(this.state.lastFullScanAt) > this.opts.config.fullScanEveryMin * 60_000;
    if (!changedSinceState && !fullScanDue) {
      this.pendingSince = null;
      this.settleUntil = null;
      this.lastWatch = watch;
      return false;
    }
    if (this.opts.once || force || !changedSinceState) {
      this.lastWatch = watch;
      return true;
    }
    if (!this.pendingSince || diffWatchSnapshots(this.pendingSince, watch).any) {
      this.pendingSince = watch;
      this.settleUntil = now + this.opts.config.settleSec * 1000;
      this.agentState = 'settling';
      return false;
    }
    if (this.settleUntil != null && now < this.settleUntil) return false;
    this.lastWatch = watch;
    return true;
  }

  private async heartbeatQuietly(): Promise<void> {
    try {
      await this.heartbeat();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (this.agentState === 'delivering') {
        // The server answered; it is the langpack that did not arrive.
        this.agentState = 'idle';
        this.journal({ event: 'delivery-error', message });
        log.warn(`vortex-agent: langpack delivery failed: ${message}`);
      } else {
        this.control.heartbeatResult(message);
        log.warn(`vortex-agent: heartbeat failed: ${message}`);
      }
    } finally {
      this.control.activity = null;
    }
  }

  /** What the page asked for since the last tick; true when a sync must run now. */
  private takeCommands(): boolean {
    if (this.control.take('redeliver')) {
      this.state.deliveredArchiveId = null;
      this.save();
      this.journal({ event: 'command', command: 'redeliver' });
    }
    if (!this.control.take('sync')) return false;
    // The same as a failed cycle coming due: plan again and run the stages.
    this.state.resyncNeeded = true;
    this.state.retryAfter = null;
    this.journal({ event: 'command', command: 'sync' });
    return true;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const syncNow = this.takeCommands();
    // Report, and deliver what is ready, before any sync: a sync may hold this
    // tick for the length of a TM run, and the langpack is ready now.
    await this.heartbeatQuietly();
    try {
      if (this.control.paused && !syncNow) {
        // paused from the page: nothing on the agent's own initiative
      } else if (this.state.retryAfter && now < Date.parse(this.state.retryAfter)) {
        // still backing off after a failure of the same change
      } else if (this.dueForSync(now, syncNow)) {
        const outcome = await runSyncCycle({
          config: this.opts.config,
          state: this.state,
          cache: this.cache,
          api: this.opts.api,
          agentKey: os.hostname(),
          onPhase: (phase) => {
            this.agentState = phase;
          },
          onInventory: (inventory) => {
            void this.videos.index(inventory);
          },
          onActivity: (text) => {
            this.control.activity = { text };
          },
          onScan: (scan) => {
            this.control.scan = scan;
          },
        });
        this.control.rejected = outcome.kind === 'unchanged' ? [] : (outcome.rejected ?? []);
        this.state.signatures.watch = this.lastWatch ? watchSignature(this.lastWatch) : null;
        this.state.lastFullScanAt = new Date().toISOString();
        this.state.lastError = null;
        this.state.failures = 0;
        this.state.retryAfter = null;
        this.pendingSince = null;
        this.settleUntil = null;
        saveHashCache(this.opts.paths.cache, this.cache);
        this.save();
        this.journal({ event: 'sync', ...outcome });
        log.info(`vortex-agent: ${outcome.kind}`);
        this.agentState = 'idle';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.failures += 1;
      this.state.resyncNeeded = true;
      this.state.lastError = message;
      this.state.retryAfter = new Date(now + retryDelayMs(this.state.failures)).toISOString();
      this.agentState = 'error';
      this.save();
      this.journal({ event: 'error', message, retryAfter: this.state.retryAfter });
      log.warn(`vortex-agent: ${message} (retry after ${this.state.retryAfter})`);
    } finally {
      this.control.activity = null;
    }
    // The sync's import may have registered videos: the second heartbeat picks their tasks up.
    await this.heartbeatQuietly();
  }

  async run(): Promise<void> {
    const sleep = this.opts.sleep ?? ((ms: number) => this.control.sleep(ms));
    const stopping = () =>
      this.control.stopping || this.control.reloading || this.opts.isStopping?.() === true;
    do {
      await this.tick();
      if (this.opts.once) return;
      if (!stopping()) await sleep(this.opts.config.pollSec * 1000);
    } while (!stopping());
  }
}
