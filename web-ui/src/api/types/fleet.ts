import type { ServiceKind } from './services';

export type FleetServiceStatus =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'stopped'
  | 'missing'
  | 'failed';
export type FleetOverride = 'start' | 'stop';

export type FleetServiceView = {
  name: string;
  status: FleetServiceStatus;
  healthy: boolean;
  inFlight: number;
  idleSinceMs: number | null;
  manual: FleetOverride | null;
  kinds: ServiceKind[];
  host: string;
  gpu: string;
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
  committedMb: number;
  usedMb: number | null;
};

export type FleetActionRecord = {
  type: 'start' | 'stop';
  service: string;
  reason: string;
  at: string;
  ok: boolean;
  error: string | null;
};

export type FleetPayload = {
  controller: 'online' | 'offline';
  at: string | null;
  pollSec: number;
  demand: Partial<Record<ServiceKind, { waiting: number; active: number }>>;
  services: FleetServiceView[];
  gpus: FleetGpuView[];
  actions: FleetActionRecord[];
};

export type FleetOverrideResult = { name: string; override: FleetOverride | null };
