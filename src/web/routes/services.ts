/**
 * services.ts (route) — what the pipeline talks to, in one place.
 *
 *   GET /api/services — every service kind with its resolved endpoints (redacted),
 *                       where they come from, live health, and pool load.
 *
 * The registry resolves endpoints (Settings → Services, the older vLLM pool setting,
 * or the environment); this route adds a fresh probe of each host so the page shows
 * the truth, not the last cached verdict. Probes run in parallel with a short timeout.
 */
import type { FastifyInstance } from 'fastify';
import { CONFIG } from '../../config';
import { llmChatPool } from '../../llm/requestPool';
import {
  SERVICE_KINDS,
  SERVICE_LABELS,
  redactServiceEndpoints,
  type ServiceEndpointPublic,
  type ServiceKind,
} from '../../services/kinds';
import type { HealthProbeResult, ServicePoolStats } from '../../services/pool';
import { servicePool } from '../../services/pools';
import { probeServiceEndpoint } from '../../services/probes';
import { serviceRegistry } from '../../services/registry';

export type ServiceEndpointStatus = ServiceEndpointPublic & {
  healthy: boolean;
  error: string | null;
  inFlight: number;
  queued: number;
};

export type ServiceKindStatus = {
  kind: ServiceKind;
  label: string;
  source: 'settings' | 'legacy-llm' | 'env' | 'asr';
  endpoints: ServiceEndpointStatus[];
  pool: Pick<ServicePoolStats, 'inFlight' | 'queued' | 'max' | 'healthyMax'> | null;
};

export type ServicesPayload = {
  services: ServiceKindStatus[];
  probedAt: string;
};

const poolStatsFor = (kind: ServiceKind): ServicePoolStats | null => {
  if (kind === 'llm') {
    const stats = llmChatPool.stats as Partial<ServicePoolStats>;
    return stats.servers
      ? {
          kind,
          inFlight: stats.inFlight ?? 0,
          queued: stats.queued ?? 0,
          max: stats.max ?? 0,
          healthyMax: stats.healthyMax ?? stats.max ?? 0,
          servers: stats.servers,
        }
      : null;
  }
  return servicePool(kind).stats;
};

/** Build the payload: one row per kind, one probe per endpoint. */
const buildServicesPayload = async (
  probe: typeof probeServiceEndpoint = probeServiceEndpoint,
): Promise<ServicesPayload> => {
  const services = await Promise.all(
    SERVICE_KINDS.map(async (kind): Promise<ServiceKindStatus> => {
      const endpoints = serviceRegistry.endpoints(kind);
      const stats = poolStatsFor(kind);
      const probes = await Promise.all(
        endpoints.map(
          (endpoint): Promise<HealthProbeResult> => probe(endpoint, CONFIG.vllmHealthTimeoutMs),
        ),
      );
      const rows = redactServiceEndpoints(endpoints).map((endpoint, index) => {
        const result = probes[index]!;
        const slot = stats?.servers.find((s) => s.host === endpoint.host);
        return {
          ...endpoint,
          healthy: result.ok,
          error: result.ok ? null : result.error,
          inFlight: slot?.inFlight ?? 0,
          queued: slot?.queued ?? 0,
        };
      });
      return {
        kind,
        label: SERVICE_LABELS[kind],
        source: serviceRegistry.sourceOf(kind),
        endpoints: rows,
        pool: stats
          ? {
              inFlight: stats.inFlight,
              queued: stats.queued,
              max: stats.max,
              healthyMax: stats.healthyMax,
            }
          : null,
      };
    }),
  );
  return { services, probedAt: new Date().toISOString() };
};

export const servicesRoutes = async (app: FastifyInstance) => {
  app.get('/api/services', async () => buildServicesPayload());
};
