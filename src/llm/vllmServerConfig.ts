import { log } from '../logger';

/** One vLLM / OpenAI-compatible inference endpoint. */
export type VllmServerEntry = {
  host: string;
  maxParallel: number;
  apiKey: string;
};

const clampMaxParallel = (value: unknown, fallback = 1): number => {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 32);
};

const readHost = (raw: Record<string, unknown>): string => {
  const host = raw.host ?? raw.url ?? raw.baseUrl ?? raw.base_url;
  return typeof host === 'string' ? host.trim() : '';
};

const readApiKey = (raw: Record<string, unknown>): string => {
  const key = raw.apiKey ?? raw.api_key ?? raw.key;
  return typeof key === 'string' ? key : '';
};

const readMaxParallel = (raw: Record<string, unknown>): number =>
  clampMaxParallel(raw.maxParallel ?? raw.max_parallel ?? raw.concurrency ?? raw.requests);

/** Normalize a JSON/DB server list; drops invalid entries. */
export const normalizeVllmServerEntries = (raw: unknown): VllmServerEntry[] => {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const servers: VllmServerEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const host = readHost(record);
    if (!host) {
      log.warn('vLLM server entry skipped: missing host/url');
      continue;
    }
    servers.push({
      host,
      maxParallel: readMaxParallel(record),
      apiKey: readApiKey(record),
    });
  }
  return servers;
};

/** Parse `VLLM_SERVERS` JSON array. Returns `null` when unset or invalid. */
export const parseVllmServersJson = (raw: string | undefined): VllmServerEntry[] | null => {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    log.warn('VLLM_SERVERS is not valid JSON — ignoring multi-server config');
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    log.warn('VLLM_SERVERS must be a non-empty JSON array — ignoring multi-server config');
    return null;
  }

  const servers = normalizeVllmServerEntries(parsed);
  return servers.length > 0 ? servers : null;
};

/** Effective vLLM chat servers: `VLLM_SERVERS` or a single legacy endpoint. */
export const resolveVllmServers = (opts: {
  serversJson?: string;
  baseUrl: string;
  apiKey: string;
  maxParallel: number;
}): VllmServerEntry[] => {
  const fromJson = parseVllmServersJson(opts.serversJson);
  if (fromJson) return fromJson;

  return [
    {
      host: opts.baseUrl,
      maxParallel: opts.maxParallel,
      apiKey: opts.apiKey,
    },
  ];
};

export const totalVllmChatParallel = (servers: readonly VllmServerEntry[]): number =>
  servers.reduce((sum, s) => sum + s.maxParallel, 0);
