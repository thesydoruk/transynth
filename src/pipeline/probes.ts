import { CONFIG } from '../config';
import { llmChatPool } from '../llm/requestPool';
import { probeVllmServerHealth } from '../llm/vllmServerHealth';
import { probeTtsHealth } from '../tts/ttsHealth';
import type { DependencyService } from './errors';

export type HealthProbeResult = { ok: true } | { ok: false; error: string };

const probeLlmHealth = async (): Promise<HealthProbeResult> => {
  if (llmChatPool.probeHealth) {
    return llmChatPool.probeHealth();
  }
  if (CONFIG.llmProvider !== 'vllm') return { ok: true };

  const server = CONFIG.vllmServers[0];
  const host = server?.host ?? CONFIG.vllmBaseUrl;
  const apiKey = server?.apiKey ?? CONFIG.vllmApiKey;
  const ok = await probeVllmServerHealth(host, apiKey, CONFIG.vllmHealthTimeoutMs);
  return ok ? { ok: true } : { ok: false, error: `vLLM health check failed (${host})` };
};

/** Live readiness probe for the service a job is about to call. */
export const probeDependencyHealth = async (
  service: DependencyService,
): Promise<HealthProbeResult> => (service === 'tts' ? probeTtsHealth() : probeLlmHealth());
