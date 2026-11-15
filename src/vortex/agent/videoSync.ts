/**
 * The loop's video side: where every video of the last inventory is, by hash,
 * and the upload of the files the server's heartbeat reply asks for.
 */
import { log } from '../../logger';
import type { VortexInventory } from '../types';
import { isVideoRelPath } from '../videoFiles';
import type { AgentApi, HeartbeatReply } from './apiClient';
import type { AgentConfig } from './config';
import { cachedFileHasher, saveHashCache, type HashCache } from './hashCache';
import type { AgentState } from './state';
import { scanForSync } from './syncCycle';
import { uploadVideoFiles } from './videoUpload';

export type AgentVideoSyncDeps = {
  config: AgentConfig;
  api: AgentApi;
  cache: HashCache;
  cachePath: string;
  state: () => AgentState;
  journal: (entry: Record<string, unknown>) => void;
  /** True while files go up, false when done. */
  onBusy: (busy: boolean) => void;
  onActivity: (text: string) => void;
};

export class AgentVideoSync {
  /** Video file hash → where the file is, from the last inventory. */
  private byHash = new Map<string, string>();

  constructor(private readonly deps: AgentVideoSyncDeps) {}

  /** Remember where every video of the inventory is, by its hash. */
  async index(inventory: VortexInventory): Promise<void> {
    const hash = cachedFileHasher(this.deps.cache);
    const index = new Map<string, string>();
    for (const unit of inventory.units) {
      for (const file of unit.files) {
        if (isVideoRelPath(file.relPath)) index.set(await hash(file.absPath), file.absPath);
      }
    }
    this.byHash = index;
  }

  /**
   * The file behind a hash the server asks about. A resident agent whose
   * staging never changed has not scanned since it started, so a hash it does
   * not know triggers one scan (cheap: the hashes are cached).
   */
  private async locate(fingerprints: readonly string[]): Promise<void> {
    if (fingerprints.every((fp) => this.byHash.has(fp))) return;
    const { config, api, cache } = this.deps;
    const scan = await scanForSync({ config, state: this.deps.state(), cache, api });
    await this.index(scan.inventory);
    saveHashCache(this.deps.cachePath, cache);
  }

  /** The video files the server waits for: found by hash and uploaded as they are. */
  async upload(tasks: HeartbeatReply['videoUploads']): Promise<void> {
    if (!this.deps.config.videos || !tasks?.length) return;
    this.deps.onBusy(true);
    try {
      await this.locate(tasks.map((t) => t.fingerprint));
      const outcome = await uploadVideoFiles({
        tasks,
        locate: (fp) => this.byHash.get(fp) ?? null,
        api: this.deps.api,
        log: (line) => {
          log.info(`vortex-agent: ${line}`);
          this.deps.onActivity(line);
        },
      });
      this.deps.journal({ event: 'video-upload', ...outcome });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.journal({ event: 'video-upload-error', message });
      log.warn(`vortex-agent: video upload failed: ${message}`);
    } finally {
      this.deps.onBusy(false);
    }
  }
}
