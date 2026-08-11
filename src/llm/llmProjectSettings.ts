/**
 * LLM chat pool config from `project_settings` (`llm.vllm_servers`).
 *
 * Empty settings fall back to env (`VLLM_SERVERS` / `VLLM_BASE_URL` + `LLM_MAX_PARALLEL`).
 * Synced at web/worker boot and whenever the setting is saved.
 */
import { CONFIG } from '../config';
import type { ProjectSettings } from '../web/services/projectSettings';
import { syncLlmChatPool } from './requestPool';
import {
  normalizeVllmServerEntries,
  parseVllmServersJson,
  resolveVllmServers,
  totalVllmChatParallel,
  type VllmServerEntry,
} from './vllmServerConfig';

const envFallbackServers = (): VllmServerEntry[] =>
  resolveVllmServers({
    serversJson: process.env.VLLM_SERVERS,
    baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000',
    apiKey: process.env.VLLM_API_KEY || '',
    maxParallel: Number.parseInt(process.env.LLM_MAX_PARALLEL || '2', 10) || 2,
  });

/** Effective chat servers: project setting when non-empty, else env. */
export const resolveVllmServersFromProjectSettings = (
  settings: ProjectSettings,
): { servers: VllmServerEntry[]; fromSettings: boolean } => {
  const fromSettings = normalizeVllmServerEntries(settings['llm.vllm_servers']);
  if (fromSettings.length > 0) return { servers: fromSettings, fromSettings: true };
  return { servers: envFallbackServers(), fromSettings: false };
};

/** Push chat-pool hosts/limits from project settings into CONFIG + the live pool. */
export const syncLlmPoolFromProjectSettings = (settings: ProjectSettings): void => {
  const { servers, fromSettings } = resolveVllmServersFromProjectSettings(settings);
  const multi = fromSettings || parseVllmServersJson(process.env.VLLM_SERVERS) != null;

  CONFIG.vllmServers = servers;
  CONFIG.llmMaxParallel = totalVllmChatParallel(servers);
  CONFIG.vllmMultiServer = multi;
  if (fromSettings && servers[0]) {
    CONFIG.vllmBaseUrl = servers[0].host;
  }

  syncLlmChatPool(servers, multi);
};
