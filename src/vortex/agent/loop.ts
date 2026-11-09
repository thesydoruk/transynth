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
import { vortexGroupKey, vortexGroupLabel } from '../groupKey';
import type { VortexAgentHeartbeat, VortexAgentState, VortexInventory } from '../types';
import { isVideoRelPath } from '../videoFiles';
import type { AgentApi, HeartbeatReply } from './apiClient';
import {
  diffWatchSnapshots,
  readWatchSnapshot,
  watchSignature,
  type WatchSnapshot,
} from './changeDetector';
import { agentDataDir, type AgentConfig } from './config';
import { cachedFileHasher, loadHashCache, saveHashCache } from './hashCache';
import { deliverLangpack, looksLikeVortexDownloads, shouldDeliver } from './langpackDelivery';
import { runSyncCycle, scanForSync } from './syncCycle';
import { uploadVideoFiles } from './videoUpload';
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
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class VortexAgentLoop {
  private state: AgentState;
  private agentState: VortexAgentState = 'idle';
  private pendingSince: WatchSnapshot | null = null;
  private settleUntil: number | null = null;
  private lastWatch: WatchSnapshot | null = null;
  private readonly cache;
  /** Video file hash → where the file is, from the last inventory. */
  private videoIndex = new Map<string, string>();

  constructor(private readonly opts: AgentLoopOptions) {
    this.state = readAgentState(opts.paths.state);
    this.cache = loadHashCache(opts.paths.cache);
  }

  private journal(entry: Record<string, unknown>): void {
    appendJournal(this.opts.paths.journal, entry);
  }

  private save(): void {
    writeAgentState(this.opts.paths.state, this.state);
  }

  private heartbeatBody(): VortexAgentHeartbeat {
    const { config } = this.opts;
    return {
      game: config.game,
      groupKey: vortexGroupKey(config.game, config.stagingPath),
      label: vortexGroupLabel(config.stagingPath, config.game),
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
    this.state.groupId = reply.groupId;
    await this.uploadVideosQuietly(reply.videoUploads);
    if (!this.opts.config.deliverLangpack) return;
    if (!shouldDeliver(reply.latestLangpack, this.state.deliveredArchiveId)) return;
    this.agentState = 'delivering';
    const { config } = this.opts;
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

  /** Remember where every video of the inventory is, by its hash. */
  private async indexVideos(inventory: VortexInventory): Promise<void> {
    const hash = cachedFileHasher(this.cache);
    const index = new Map<string, string>();
    for (const unit of inventory.units) {
      for (const file of unit.files) {
        if (isVideoRelPath(file.relPath)) index.set(await hash(file.absPath), file.absPath);
      }
    }
    this.videoIndex = index;
  }

  /**
   * The file behind a hash the server asks about. A resident agent whose
   * staging never changed has not scanned since it started, so a hash it does
   * not know triggers one scan (cheap: the hashes are cached).
   */
  private async locateVideos(fingerprints: readonly string[]): Promise<void> {
    if (fingerprints.every((fp) => this.videoIndex.has(fp))) return;
    const scan = await scanForSync({
      config: this.opts.config,
      state: this.state,
      cache: this.cache,
      api: this.opts.api,
    });
    await this.indexVideos(scan.inventory);
    saveHashCache(this.opts.paths.cache, this.cache);
  }

  /** The video files the server waits for: found by hash and uploaded as they are. */
  private async uploadVideosQuietly(tasks: HeartbeatReply['videoUploads']): Promise<void> {
    const { config } = this.opts;
    if (!config.videos || !tasks?.length) return;
    this.agentState = 'uploading';
    try {
      await this.locateVideos(tasks.map((t) => t.fingerprint));
      const outcome = await uploadVideoFiles({
        tasks,
        locate: (fp) => this.videoIndex.get(fp) ?? null,
        api: this.opts.api,
        log: (line) => log.info(`vortex-agent: ${line}`),
      });
      this.journal({ event: 'video-upload', ...outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.journal({ event: 'video-upload-error', message });
      log.warn(`vortex-agent: video upload failed: ${message}`);
    } finally {
      this.agentState = 'idle';
    }
  }

  /** Did staging change, and has it been quiet long enough to sync? */
  private dueForSync(now: number): boolean {
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
    if (this.opts.once || !changedSinceState) {
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
      log.warn(
        `vortex-agent: heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async tick(): Promise<void> {
    const now = Date.now();
    // Report, and deliver what is ready, before any sync: a sync may hold this
    // tick for the length of a TM run, and the langpack is ready now.
    await this.heartbeatQuietly();
    try {
      if (this.state.retryAfter && now < Date.parse(this.state.retryAfter)) {
        // still backing off after a failure of the same change
      } else if (this.dueForSync(now)) {
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
            void this.indexVideos(inventory);
          },
        });
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
    }
    // The sync's import may have registered videos: the second heartbeat picks their tasks up.
    await this.heartbeatQuietly();
  }

  async run(): Promise<void> {
    const sleep = this.opts.sleep ?? defaultSleep;
    do {
      await this.tick();
      if (this.opts.once) return;
      await sleep(this.opts.config.pollSec * 1000);
    } while (!this.opts.isStopping?.());
  }
}
