/**
 * The decision: which services to start and which to stop, given demand and VRAM.
 *
 * Pure. The controller gathers the state and executes the actions; this function only
 * reasons. Rules, in order:
 *
 * 1. A kind is wanted when a queue has jobs waiting or active for it, or an operator
 *    asked for a service by hand.
 * 2. A wanted kind with no running healthy service gets the highest-priority service
 *    that provides it, if its VRAM fits on its GPU next to what already runs or starts.
 * 3. If it does not fit, services on that GPU that nobody wants, that carry no load,
 *    that have idled past their own limit and that rank below the newcomer are stopped,
 *    lowest priority first, until it would fit. The start follows on a later tick once
 *    the VRAM is actually free.
 * 4. Nothing else is stopped: a resident service that nobody is contending with stays.
 *
 * Switching costs minutes (vLLM cold start), so the scheduler reacts to "wanted and
 * absent", not to every job; serial queues already batch work per resource.
 */
import type { ServiceKind } from '../services/kinds';
import type { FleetInventory, FleetService } from './inventory';

export type ServiceStatus = 'running' | 'starting' | 'stopping' | 'stopped' | 'missing' | 'failed';

export type ServiceState = {
  name: string;
  status: ServiceStatus;
  /** Last probe verdict; meaningful while running. */
  healthy: boolean;
  /** Requests in flight against it, when known (0 when unknown). */
  inFlight: number;
  /** When demand for its kinds last ended; null while wanted or never seen idle. */
  idleSinceMs: number | null;
  /** Operator asked for it (start) or against it (stop); null = scheduler decides. */
  manual: 'start' | 'stop' | null;
};

export type Demand = Partial<Record<ServiceKind, { waiting: number; active: number }>>;

export type FleetAction =
  | { type: 'start'; service: string; reason: string }
  | { type: 'stop'; service: string; reason: string };

export type PlanInput = {
  inventory: FleetInventory;
  states: ServiceState[];
  demand: Demand;
  nowMs: number;
};

const wantedKinds = (demand: Demand): Set<ServiceKind> => {
  const out = new Set<ServiceKind>();
  for (const [kind, d] of Object.entries(demand) as Array<
    [ServiceKind, { waiting: number; active: number }]
  >) {
    if (d && (d.waiting > 0 || d.active > 0)) out.add(kind);
  }
  return out;
};

const isWanted = (
  service: FleetService,
  wanted: Set<ServiceKind>,
  state: ServiceState | undefined,
): boolean =>
  state?.manual === 'start' || service.keep || service.kinds.some((kind) => wanted.has(kind));

/** VRAM a GPU has committed to services that are up or coming up. */
const committedMb = (
  inventory: FleetInventory,
  byName: Map<string, ServiceState>,
  host: string,
  gpu: number,
): number =>
  inventory.services
    .filter((s) => s.host === host && s.gpu === gpu)
    .filter((s) => {
      const status = byName.get(s.name)?.status;
      return status === 'running' || status === 'starting' || status === 'stopping';
    })
    .reduce((sum, s) => sum + s.vramMb, 0);

const gpuCapacityMb = (inventory: FleetInventory, host: string, gpu: number): number =>
  inventory.hosts.find((h) => h.name === host)?.gpus.find((g) => g.index === gpu)?.vramMb ?? 0;

export const planFleet = ({ inventory, states, demand, nowMs }: PlanInput): FleetAction[] => {
  const byName = new Map(states.map((s) => [s.name, s]));
  const wanted = wantedKinds(demand);
  const actions: FleetAction[] = [];
  const stopping = new Set<string>();

  // Operator stops win over everything.
  for (const service of inventory.services) {
    const state = byName.get(service.name);
    if (state?.manual === 'stop' && (state.status === 'running' || state.status === 'starting')) {
      actions.push({ type: 'stop', service: service.name, reason: 'stopped by operator' });
      stopping.add(service.name);
    }
  }

  // Kinds that are wanted and have no healthy provider up (or coming up).
  // `service` pins the need to one inventory entry (operator start, `keep`); a kind-level
  // need takes the best candidate that provides the kind.
  const needKinds: Array<{ kind: ServiceKind; reason: string; service?: string }> = [];
  for (const kind of wanted) {
    const providers = inventory.services.filter((s) => s.kinds.includes(kind));
    const covered = providers.some((s) => {
      const st = byName.get(s.name);
      return (
        st &&
        (st.status === 'starting' || (st.status === 'running' && st.healthy)) &&
        !stopping.has(s.name)
      );
    });
    if (!covered && providers.length > 0) {
      const d = demand[kind];
      needKinds.push({
        kind,
        reason: `${kind} wanted: ${d?.waiting ?? 0} waiting, ${d?.active ?? 0} active`,
      });
    }
  }
  for (const service of inventory.services) {
    const state = byName.get(service.name);
    const down = !state || state.status === 'stopped' || state.status === 'missing';
    if (state?.manual === 'start' && down) {
      needKinds.push({
        kind: service.kinds[0]!,
        reason: `${service.name} requested by operator`,
        service: service.name,
      });
    } else if (service.keep && down && state?.manual !== 'stop') {
      needKinds.push({
        kind: service.kinds[0]!,
        reason: `${service.name} is kept up`,
        service: service.name,
      });
    }
  }

  const started = new Set<string>();
  for (const need of needKinds) {
    const candidates = inventory.services
      .filter((s) => s.kinds.includes(need.kind))
      .filter((s) => {
        // `failed` is not a candidate: the controller hands it back as stopped once
        // its cooldown has passed, so a broken service is retried, not hammered.
        const st = byName.get(s.name);
        return !st || st.status === 'stopped' || st.status === 'missing';
      })
      .filter((s) => byName.get(s.name)?.manual !== 'stop')
      .sort((a, b) => b.priority - a.priority);
    const candidate = need.service
      ? candidates.find((s) => s.name === need.service)
      : (candidates.find((s) => byName.get(s.name)?.manual === 'start') ?? candidates[0]);
    if (!candidate || started.has(candidate.name)) continue;

    // A CPU service takes no VRAM and contends with nothing.
    const capacity =
      candidate.gpu == null ? 0 : gpuCapacityMb(inventory, candidate.host, candidate.gpu);
    const committed =
      candidate.gpu == null ? 0 : committedMb(inventory, byName, candidate.host, candidate.gpu);
    const free = capacity - committed;
    if (candidate.gpu == null || candidate.vramMb <= free) {
      actions.push({ type: 'start', service: candidate.name, reason: need.reason });
      started.add(candidate.name);
      byName.set(candidate.name, {
        name: candidate.name,
        status: 'starting',
        healthy: false,
        inFlight: 0,
        idleSinceMs: null,
        manual: byName.get(candidate.name)?.manual ?? null,
      });
      continue;
    }

    // Evict: idle, unloaded, unwanted, lower-priority residents on the same GPU.
    const victims = inventory.services
      .filter(
        (s) => s.host === candidate.host && s.gpu === candidate.gpu && s.name !== candidate.name,
      )
      .filter((s) => {
        const st = byName.get(s.name);
        if (!st || st.status !== 'running' || stopping.has(s.name)) return false;
        if (isWanted(s, wanted, st) || st.inFlight > 0) return false;
        if (s.priority >= candidate.priority) return false;
        return st.idleSinceMs != null && nowMs - st.idleSinceMs >= s.idleUnloadSec * 1000;
      })
      .sort((a, b) => a.priority - b.priority);
    let freed = 0;
    for (const victim of victims) {
      if (candidate.vramMb <= free + freed) break;
      actions.push({
        type: 'stop',
        service: victim.name,
        reason: `freeing ${victim.vramMb} MB on ${candidate.host} gpu${candidate.gpu} for ${candidate.name} (${need.reason})`,
      });
      stopping.add(victim.name);
      freed += victim.vramMb;
    }
  }
  return actions;
};
