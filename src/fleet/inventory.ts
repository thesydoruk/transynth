/**
 * The fleet inventory: which hosts exist, which GPUs they carry, and which services may
 * run where. Read from `fleet.yml` (`FLEET_CONFIG`); see `fleet.example.yml`.
 *
 * Hosts are "dumb": Docker with the NVIDIA toolkit and the compose projects checked out.
 * A service is one compose service on one host, pinned to one GPU, with the VRAM it
 * takes once up (declared, since vLLM pre-allocates whatever it is told to) and the
 * priority that decides who leaves when the card is contended.
 */
import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { SERVICE_KINDS, type ServiceKind } from '../services/kinds';

export type FleetGpu = { index: number; name: string; vramMb: number };

export type FleetHost = {
  name: string;
  /**
   * ssh target (`user@host` or an alias from `~/.ssh/config`): compose runs on the host
   * through it, and `nvidia-smi` is read the same way. The usual case.
   */
  ssh: string | null;
  /**
   * Docker context name, for a host whose compose files the controller can read itself
   * (the controller runs on that box). Used only when `ssh` is not set.
   */
  context: string | null;
  gpus: FleetGpu[];
  /** Service kinds allowed on this host; a service of another kind is a config error. */
  allow: ServiceKind[];
};

export type FleetService = {
  name: string;
  /** Kinds this one container serves (audio-intel serves `asr` and `separate`). */
  kinds: ServiceKind[];
  host: string;
  /** GPU index on the host, or null for a CPU service (no VRAM accounting). */
  gpu: number | null;
  /** Keep it up whenever possible, demand or not (bethesda-tools, which nothing "needs"). */
  keep: boolean;
  compose: {
    dir: string;
    /** Extra `-f` files, relative to `dir` (a project with several compose files). */
    files: string[];
    project: string | null;
    /** Compose services started and stopped together (an engine and its gateway). */
    services: string[];
  };
  /** How the pipeline reaches it when it is up; becomes a managed registry row. */
  url: string;
  maxParallel: number;
  apiKey: string;
  vramMb: number;
  /** Higher stays longer when the GPU is contended. */
  priority: number;
  /** Seconds without demand before the service may be stopped to free VRAM. */
  idleUnloadSec: number;
  /** Seconds the controller waits for `/health` after `up` before giving up. */
  startTimeoutSec: number;
};

export type FleetInventory = {
  /** Controller tick interval. */
  pollSec: number;
  hosts: FleetHost[];
  services: FleetService[];
};

const DEFAULTS = {
  pollSec: 15,
  maxParallel: 1,
  priority: 0,
  idleUnloadSec: 300,
  startTimeoutSec: 600,
};

const asString = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`fleet: ${what} must be a non-empty string`);
  return value.trim();
};

const asInt = (value: unknown, what: string, fallback?: number): number => {
  if (value == null && fallback != null) return fallback;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw new Error(`fleet: ${what} must be a number`);
  return Math.floor(n);
};

const asKinds = (value: unknown, what: string): ServiceKind[] => {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  const kinds = list.map((k) => {
    if (!(SERVICE_KINDS as readonly string[]).includes(String(k))) {
      throw new Error(`fleet: ${what} has unknown service kind ${JSON.stringify(k)}`);
    }
    return k as ServiceKind;
  });
  if (kinds.length === 0) throw new Error(`fleet: ${what} needs at least one kind`);
  return kinds;
};

const parseHost = (raw: Record<string, unknown>): FleetHost => {
  const name = asString(raw.name, 'host.name');
  const gpus = (Array.isArray(raw.gpus) ? raw.gpus : []).map((g, i) => {
    const gpu = (g ?? {}) as Record<string, unknown>;
    return {
      index: asInt(gpu.index, `host ${name} gpus[${i}].index`, i),
      name: typeof gpu.name === 'string' ? gpu.name : `gpu${i}`,
      vramMb: asInt(gpu.vramMb, `host ${name} gpus[${i}].vramMb`),
    };
  });
  const ssh = typeof raw.ssh === 'string' && raw.ssh.trim() ? raw.ssh.trim() : null;
  const contextRaw = raw.context ?? raw.docker;
  const context = typeof contextRaw === 'string' && contextRaw.trim() ? contextRaw.trim() : null;
  if (!ssh && !context) throw new Error(`fleet: host ${name} needs ssh (or a docker context)`);
  return {
    name,
    ssh,
    context,
    gpus,
    allow: raw.allow == null ? [...SERVICE_KINDS] : asKinds(raw.allow, `host ${name}.allow`),
  };
};

const parseService = (raw: Record<string, unknown>, hosts: FleetHost[]): FleetService => {
  const name = asString(raw.name, 'service.name');
  const hostName = asString(raw.host, `service ${name}.host`);
  const host = hosts.find((h) => h.name === hostName);
  if (!host) throw new Error(`fleet: service ${name} refers to unknown host ${hostName}`);
  const kinds = asKinds(raw.kinds ?? raw.kind, `service ${name}.kinds`);
  for (const kind of kinds) {
    if (!host.allow.includes(kind)) {
      throw new Error(`fleet: service ${name} is kind ${kind}, not allowed on host ${hostName}`);
    }
  }
  // No `gpu` and no `vramMb` is a CPU service; `vramMb` alone lands on gpu 0 as before.
  const gpu =
    raw.gpu != null ? asInt(raw.gpu, `service ${name}.gpu`) : raw.vramMb != null ? 0 : null;
  if (gpu != null && !host.gpus.some((g) => g.index === gpu)) {
    throw new Error(
      `fleet: service ${name} wants gpu ${gpu}, host ${hostName} has none with that index`,
    );
  }
  const vramMb = asInt(raw.vramMb, `service ${name}.vramMb`, gpu == null ? 0 : undefined);
  const compose = (raw.compose ?? {}) as Record<string, unknown>;
  const servicesRaw = compose.services ?? compose.service;
  const composeServices = (Array.isArray(servicesRaw) ? servicesRaw : [servicesRaw]).map((s) =>
    asString(s, `service ${name}.compose.services`),
  );
  const filesRaw = compose.files ?? compose.file;
  const composeFiles = (
    Array.isArray(filesRaw) ? filesRaw : filesRaw == null ? [] : [filesRaw]
  ).map((f) => asString(f, `service ${name}.compose.files`));
  return {
    name,
    kinds,
    host: hostName,
    gpu,
    keep: raw.keep === true,
    compose: {
      dir: asString(compose.dir, `service ${name}.compose.dir`),
      files: composeFiles,
      project: typeof compose.project === 'string' && compose.project ? compose.project : null,
      services: composeServices,
    },
    url: asString(raw.url, `service ${name}.url`).replace(/\/+$/, ''),
    maxParallel: Math.max(
      1,
      asInt(raw.maxParallel, `service ${name}.maxParallel`, DEFAULTS.maxParallel),
    ),
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    vramMb,
    priority: asInt(raw.priority, `service ${name}.priority`, DEFAULTS.priority),
    idleUnloadSec: asInt(
      raw.idleUnloadSec,
      `service ${name}.idleUnloadSec`,
      DEFAULTS.idleUnloadSec,
    ),
    startTimeoutSec: asInt(
      raw.startTimeoutSec,
      `service ${name}.startTimeoutSec`,
      DEFAULTS.startTimeoutSec,
    ),
  };
};

/** Parse and validate inventory text (YAML or JSON). */
export const parseFleetInventory = (text: string): FleetInventory => {
  const doc = (parseYaml(text) ?? {}) as Record<string, unknown>;
  const hosts = (Array.isArray(doc.hosts) ? doc.hosts : []).map((h) =>
    parseHost((h ?? {}) as Record<string, unknown>),
  );
  if (hosts.length === 0) throw new Error('fleet: no hosts');
  const names = new Set<string>();
  for (const host of hosts) {
    if (names.has(host.name)) throw new Error(`fleet: duplicate host ${host.name}`);
    names.add(host.name);
  }
  const services = (Array.isArray(doc.services) ? doc.services : []).map((s) =>
    parseService((s ?? {}) as Record<string, unknown>, hosts),
  );
  const serviceNames = new Set<string>();
  for (const service of services) {
    if (serviceNames.has(service.name)) throw new Error(`fleet: duplicate service ${service.name}`);
    serviceNames.add(service.name);
  }
  return {
    pollSec: Math.max(2, asInt(doc.pollSec, 'pollSec', DEFAULTS.pollSec)),
    hosts,
    services,
  };
};

export const loadFleetInventory = (path: string): FleetInventory =>
  parseFleetInventory(fs.readFileSync(path, 'utf8'));

export const fleetHost = (inventory: FleetInventory, name: string): FleetHost => {
  const host = inventory.hosts.find((h) => h.name === name);
  if (!host) throw new Error(`fleet: unknown host ${name}`);
  return host;
};
