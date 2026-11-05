/**
 * "Is there a healthy host for this kind right now?" — the question a stage
 * button asks before it starts a job that would otherwise sit in the queue
 * waiting for an LLM or TTS host that may be switched off.
 */
import { CONFIG } from '../config';
import type { ServiceKind } from './kinds';
import { probeServiceEndpoint } from './probes';
import { serviceRegistry } from './registry';

export type KindHealth = Partial<Record<ServiceKind, boolean>>;

export const probeKindHealthy = async (
  kind: ServiceKind,
  probe: typeof probeServiceEndpoint = probeServiceEndpoint,
): Promise<boolean> => {
  const endpoints = serviceRegistry.endpoints(kind);
  if (endpoints.length === 0) return false;
  const results = await Promise.all(
    endpoints.map((endpoint) => probe(endpoint, CONFIG.vllmHealthTimeoutMs)),
  );
  return results.some((result) => result.ok);
};

export const probeKindsHealthy = async (
  kinds: readonly ServiceKind[],
  probe: typeof probeServiceEndpoint = probeServiceEndpoint,
): Promise<KindHealth> => {
  const flags = await Promise.all(kinds.map((kind) => probeKindHealthy(kind, probe)));
  return Object.fromEntries(kinds.map((kind, i) => [kind, flags[i]])) as KindHealth;
};
