/**
 * Process-wide pools, one per service kind, built from the registry.
 *
 * `llm` keeps its own pool (`llmChatPool`, an OpenAI client per host with the same
 * behaviour); every other kind is served from here. A pool is created on first use
 * and rebuilt when the registry's endpoints for that kind change.
 */
import { probeServiceEndpoint } from './probes';
import { serviceRegistry } from './registry';
import { ServicePool } from './pool';
import type { ServiceKind } from './kinds';

/** The client of a URL-based service is its base URL; the HTTP call lives at the call site. */
export type UrlPool = ServicePool<string>;

const pools = new Map<ServiceKind, UrlPool>();

const build = (kind: ServiceKind): UrlPool =>
  new ServicePool<string>({
    kind,
    endpoints: serviceRegistry.endpoints(kind),
    createClient: (endpoint) => endpoint.host,
    probe: probeServiceEndpoint,
  });

/** The pool for one kind (not `llm`: that is `llmChatPool`). */
export const servicePool = (kind: Exclude<ServiceKind, 'llm'>): UrlPool => {
  let pool = pools.get(kind);
  if (!pool) {
    pool = build(kind);
    pools.set(kind, pool);
  }
  return pool;
};

/** Drop every pool (tests, shutdown); the next use rebuilds from the registry. */
export const disposeServicePools = (): void => {
  for (const pool of pools.values()) pool.dispose();
  pools.clear();
};

serviceRegistry.onChange((kind) => {
  const pool = pools.get(kind);
  if (!pool) return;
  pool.dispose();
  pools.delete(kind);
});
