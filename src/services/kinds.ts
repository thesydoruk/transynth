/**
 * The kinds of external services the pipeline calls, and one endpoint shape for all of them.
 *
 * Until now every service had its own env variable, its own client and its own idea
 * of "healthy": a vLLM pool in project settings, `TTS_BASE_URL`, `AUDIO_INTEL_BASE_URL`,
 * `BETHESDA_TOOLS_URL`. The registry (`./registry`) keeps one list of endpoints keyed
 * by kind; env stays the bootstrap, the project setting `services.endpoints` the
 * runtime truth, and a fleet controller the future writer of managed rows.
 */
import { log } from '../logger';

export const SERVICE_KINDS = ['llm', 'embed', 'tts', 'asr', 'separate', 'tools'] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number];

const isServiceKind = (value: unknown): value is ServiceKind =>
  typeof value === 'string' && (SERVICE_KINDS as readonly string[]).includes(value);

/** Human names for logs, system-log lines and the UI. */
export const SERVICE_LABELS: Record<ServiceKind, string> = {
  llm: 'LLM',
  embed: 'Embeddings',
  tts: 'TTS',
  asr: 'audio-intel',
  separate: 'audio-intel (separation)',
  tools: 'bethesda-tools',
};

/** One reachable server of one kind. `managed` rows are written by a controller, not by hand. */
export type ServiceEndpoint = {
  kind: ServiceKind;
  host: string;
  maxParallel: number;
  apiKey: string;
  managed: boolean;
};

/** What the API returns: never the raw key. */
export type ServiceEndpointPublic = Omit<ServiceEndpoint, 'apiKey'> & { apiKeyConfigured: boolean };

const MAX_PARALLEL_CAP = 32;

const clampMaxParallel = (value: unknown, fallback = 1): number => {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), MAX_PARALLEL_CAP);
};

/** Endpoints must be http(s); the server calls them (operator-trusted LAN). */
const isAllowedServiceUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeServiceHost = (raw: string): string => raw.trim().replace(/\/+$/, '');

/** Normalize a JSON/DB endpoint list; drops invalid rows with a warning. */
export const normalizeServiceEndpoints = (raw: unknown): ServiceEndpoint[] => {
  if (!Array.isArray(raw)) return [];
  const out: ServiceEndpoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (!isServiceKind(record.kind)) {
      log.warn(`service endpoint skipped: unknown kind ${String(record.kind)}`);
      continue;
    }
    const hostRaw = record.host ?? record.url ?? record.baseUrl ?? record.base_url;
    const host = typeof hostRaw === 'string' ? normalizeServiceHost(hostRaw) : '';
    if (!host || !isAllowedServiceUrl(host)) {
      log.warn(
        `service endpoint skipped: ${record.kind} host must be http(s) (${host || 'empty'})`,
      );
      continue;
    }
    const apiKey = record.apiKey ?? record.api_key ?? record.key;
    out.push({
      kind: record.kind,
      host,
      maxParallel: clampMaxParallel(
        record.maxParallel ?? record.max_parallel ?? record.concurrency,
      ),
      apiKey: typeof apiKey === 'string' ? apiKey : '',
      managed: record.managed === true,
    });
  }
  return out;
};

export const redactServiceEndpoints = (
  endpoints: readonly ServiceEndpoint[],
): ServiceEndpointPublic[] =>
  endpoints.map(({ apiKey, ...rest }) => ({ ...rest, apiKeyConfigured: Boolean(apiKey) }));

/** A blank incoming key keeps the stored key for the same kind + host. */
export const retainServiceApiKeys = (
  incoming: readonly ServiceEndpoint[],
  stored: readonly ServiceEndpoint[],
): ServiceEndpoint[] =>
  incoming.map((endpoint) => ({
    ...endpoint,
    apiKey:
      endpoint.apiKey.trim() ||
      stored.find((row) => row.kind === endpoint.kind && row.host === endpoint.host)?.apiKey ||
      '',
  }));
