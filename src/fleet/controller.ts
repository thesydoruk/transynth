/**
 * The fleet controller loop: observe, decide, act, tell the registry.
 *
 * Each tick: read demand from the queues and overrides from the operator; look at every
 * inventory service (container state through the host driver, `/health` through the
 * service probe); let the scheduler decide; run the starts and stops; then write the
 * services that are up and healthy into the project setting `services.endpoints` as
 * `managed` rows, so web and worker route to them, and publish a snapshot for the UI.
 *
 * A start is `starting` until the probe passes or `startTimeoutSec` elapses (then
 * `failed`, retried after another timeout); a stop is `stopping` until the container
 * is down. Idle time is counted per service from the moment its kinds left demand.
 */
import type { HealthProbeResult } from '../services/pool';
import type { ServiceEndpoint } from '../services/kinds';
import type { FleetOverride } from './channel';
import type { QueueCounts } from './demand';
import { readDemand } from './demand';
import { fleetHost, type FleetInventory, type FleetService } from './inventory';
import type { HostDriver } from './driver';
import { planFleet, type Demand, type FleetAction, type ServiceState } from './scheduler';

export type FleetServiceView = ServiceState & {
  kinds: FleetService['kinds'];
  host: string;
  gpu: number | null;
  url: string;
  vramMb: number;
  priority: number;
  container: 'running' | 'stopped' | 'missing' | 'unknown';
  lastError: string | null;
};

export type FleetGpuView = {
  host: string;
  index: number;
  name: string;
  vramMb: number;
  /** Declared VRAM of services up or coming up on it. */
  committedMb: number;
  /** nvidia-smi reading, when the host gives one. */
  usedMb: number | null;
};

export type FleetActionRecord = FleetAction & { at: string; ok: boolean; error: string | null };

export type FleetSnapshot = {
  at: string;
  pollSec: number;
  demand: Demand;
  services: FleetServiceView[];
  gpus: FleetGpuView[];
  actions: FleetActionRecord[];
};

export type FleetControllerDeps = {
  readCounts: (queueName: string) => Promise<QueueCounts>;
  probe: (endpoint: ServiceEndpoint, timeoutMs: number) => Promise<HealthProbeResult>;
  readEndpoints: () => Promise<ServiceEndpoint[]>;
  writeEndpoints: (rows: ServiceEndpoint[]) => Promise<void>;
  readOverrides: (services: readonly string[]) => Promise<Record<string, FleetOverride>>;
  publish: (snapshot: FleetSnapshot) => Promise<void>;
  log: { info: (msg: string, meta?: unknown) => void; warn: (msg: string, meta?: unknown) => void };
  now?: () => number;
  probeTimeoutMs?: number;
};

type Tracked = ServiceState & {
  startedAtMs: number | null;
  failedAtMs: number | null;
  container: FleetServiceView['container'];
  lastError: string | null;
};

const MAX_ACTION_HISTORY = 50;

export class FleetController {
  private readonly tracked = new Map<string, Tracked>();
  private readonly actions: FleetActionRecord[] = [];
  private lastEndpointsJson = '';
  private readonly now: () => number;

  constructor(
    readonly inventory: FleetInventory,
    private readonly driver: HostDriver,
    private readonly deps: FleetControllerDeps,
  ) {
    this.now = deps.now ?? Date.now;
    for (const service of inventory.services) {
      this.tracked.set(service.name, {
        name: service.name,
        status: 'missing',
        healthy: false,
        inFlight: 0,
        idleSinceMs: null,
        manual: null,
        startedAtMs: null,
        failedAtMs: null,
        container: 'unknown',
        lastError: null,
      });
    }
  }

  async tick(): Promise<FleetSnapshot> {
    const nowMs = this.now();
    const demand = await readDemand(this.deps.readCounts);
    const overrides = await this.deps.readOverrides(this.inventory.services.map((s) => s.name));
    await this.observe(demand, overrides, nowMs);
    const actions = planFleet({
      inventory: this.inventory,
      states: [...this.tracked.values()],
      demand,
      nowMs,
    });
    await this.execute(actions, nowMs);
    await this.syncEndpoints();
    const snapshot = await this.snapshot(demand, nowMs);
    await this.deps.publish(snapshot);
    return snapshot;
  }

  private async observe(
    demand: Demand,
    overrides: Record<string, FleetOverride>,
    nowMs: number,
  ): Promise<void> {
    for (const service of this.inventory.services) {
      const t = this.tracked.get(service.name)!;
      const host = fleetHost(this.inventory, service.host);
      t.manual = overrides[service.name] ?? null;

      let container: FleetServiceView['container'] = 'unknown';
      try {
        container = await this.driver.containerState(host, service);
        t.lastError = null;
      } catch (err) {
        t.lastError = err instanceof Error ? err.message : String(err);
        this.deps.log.warn('fleet: container state failed', {
          service: service.name,
          error: t.lastError,
        });
      }
      t.container = container;

      if (container === 'running') {
        const result = await this.deps.probe(
          {
            kind: service.kinds[0]!,
            host: service.url,
            maxParallel: service.maxParallel,
            apiKey: service.apiKey,
            managed: true,
          },
          this.deps.probeTimeoutMs ?? 5_000,
        );
        t.healthy = result.ok;
        if (t.status === 'starting') {
          if (result.ok) {
            t.status = 'running';
            this.deps.log.info('fleet: service healthy', { service: service.name });
          } else if (
            t.startedAtMs != null &&
            nowMs - t.startedAtMs > service.startTimeoutSec * 1000
          ) {
            t.status = 'failed';
            t.failedAtMs = nowMs;
            t.lastError = `not healthy ${service.startTimeoutSec}s after start: ${result.error}`;
            this.deps.log.warn('fleet: service failed to come up', {
              service: service.name,
              error: t.lastError,
            });
          }
        } else if (t.status === 'failed') {
          if (result.ok) {
            t.status = 'running';
          } else if (
            t.failedAtMs != null &&
            nowMs - t.failedAtMs > service.startTimeoutSec * 1000
          ) {
            // Up but unhealthy past the cooldown: eligible for another attempt
            // (`up --no-recreate` is a no-op, but the start window reopens).
            t.status = 'stopped';
          }
        } else if (t.status !== 'stopping') {
          t.status = 'running';
        }
      } else if (container === 'stopped' || container === 'missing') {
        t.healthy = false;
        if (t.status === 'starting') {
          if (t.startedAtMs != null && nowMs - t.startedAtMs > service.startTimeoutSec * 1000) {
            t.status = 'failed';
            t.failedAtMs = nowMs;
            t.lastError = `container not running ${service.startTimeoutSec}s after start`;
          }
        } else if (t.status === 'failed') {
          if (t.failedAtMs != null && nowMs - t.failedAtMs > service.startTimeoutSec * 1000) {
            t.status = container; // cooldown over: eligible again
          }
        } else {
          t.status = container;
        }
      }

      const wanted =
        t.manual === 'start' ||
        service.kinds.some((kind) => {
          const d = demand[kind];
          return d != null && (d.waiting > 0 || d.active > 0);
        });
      t.idleSinceMs = wanted ? null : (t.idleSinceMs ?? nowMs);
    }
  }

  private async execute(actions: FleetAction[], nowMs: number): Promise<void> {
    for (const action of actions) {
      const service = this.inventory.services.find((s) => s.name === action.service)!;
      const host = fleetHost(this.inventory, service.host);
      const t = this.tracked.get(service.name)!;
      let ok = true;
      let error: string | null = null;
      try {
        if (action.type === 'start') {
          this.deps.log.info('fleet: starting service', {
            service: service.name,
            reason: action.reason,
          });
          await this.driver.up(host, service);
          t.status = 'starting';
          t.startedAtMs = nowMs;
          t.failedAtMs = null;
          t.healthy = false;
        } else {
          this.deps.log.info('fleet: stopping service', {
            service: service.name,
            reason: action.reason,
          });
          await this.driver.stop(host, service);
          t.status = 'stopping';
          t.healthy = false;
        }
      } catch (err) {
        ok = false;
        error = err instanceof Error ? err.message : String(err);
        t.lastError = error;
        if (action.type === 'start') {
          t.status = 'failed';
          t.failedAtMs = nowMs;
        }
        this.deps.log.warn('fleet: action failed', { ...action, error });
      }
      this.actions.unshift({ ...action, at: new Date(nowMs).toISOString(), ok, error });
      if (this.actions.length > MAX_ACTION_HISTORY) this.actions.length = MAX_ACTION_HISTORY;
    }
  }

  /** Managed registry rows = services up and healthy; hand-written rows are kept. */
  private async syncEndpoints(): Promise<void> {
    const managed: ServiceEndpoint[] = [];
    for (const service of this.inventory.services) {
      const t = this.tracked.get(service.name)!;
      if (t.status !== 'running' || !t.healthy) continue;
      for (const kind of service.kinds) {
        managed.push({
          kind,
          host: service.url,
          maxParallel: service.maxParallel,
          apiKey: service.apiKey,
          managed: true,
        });
      }
    }
    const json = JSON.stringify(managed);
    if (json === this.lastEndpointsJson) return;
    const current = await this.deps.readEndpoints();
    const rows = [...current.filter((row) => !row.managed), ...managed];
    await this.deps.writeEndpoints(rows);
    this.lastEndpointsJson = json;
    this.deps.log.info('fleet: managed endpoints updated', {
      managed: managed.map((m) => `${m.kind}@${m.host}`),
    });
  }

  private async snapshot(demand: Demand, nowMs: number): Promise<FleetSnapshot> {
    const services: FleetServiceView[] = this.inventory.services.map((service) => {
      const t = this.tracked.get(service.name)!;
      return {
        name: t.name,
        status: t.status,
        healthy: t.healthy,
        inFlight: t.inFlight,
        idleSinceMs: t.idleSinceMs,
        manual: t.manual,
        kinds: service.kinds,
        host: service.host,
        gpu: service.gpu,
        url: service.url,
        vramMb: service.vramMb,
        priority: service.priority,
        container: t.container,
        lastError: t.lastError,
      };
    });
    const gpus: FleetGpuView[] = [];
    for (const host of this.inventory.hosts) {
      for (const gpu of host.gpus) {
        const committedMb = this.inventory.services
          .filter((s) => s.host === host.name && s.gpu === gpu.index)
          .filter((s) =>
            ['running', 'starting', 'stopping'].includes(this.tracked.get(s.name)!.status),
          )
          .reduce((sum, s) => sum + s.vramMb, 0);
        gpus.push({
          host: host.name,
          index: gpu.index,
          name: gpu.name,
          vramMb: gpu.vramMb,
          committedMb,
          usedMb: await this.driver.gpuUsedMb(host, gpu.index),
        });
      }
    }
    return {
      at: new Date(nowMs).toISOString(),
      pollSec: this.inventory.pollSec,
      demand,
      services,
      gpus,
      actions: [...this.actions],
    };
  }
}
