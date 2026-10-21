/**
 * Where every external service lives: one list of endpoints by kind.
 *
 * Resolution per kind, first non-empty wins:
 *   1. project setting `services.endpoints` rows of that kind (Settings → Services, or a
 *      fleet controller writing `managed` rows);
 *   2. for `llm`, the older project setting `llm.vllm_servers`, which keeps working;
 *   3. the environment: `VLLM_SERVERS` / `VLLM_BASE_URL`, `VLLM_EMBED_BASE_URL`,
 *      `TTS_BASE_URL`, `AUDIO_INTEL_BASE_URL`, `BETHESDA_TOOLS_URL`.
 *
 * `separate` (audio-intel's batch lane) defaults to the `asr` hosts: it is the same
 * process; a row of its own is only needed when separation runs elsewhere.
 */
import { CONFIG } from '../config';
import { resolveAudioIntelBaseUrl } from '../audioIntel/baseUrl';
import { resolveBethesdaToolsUrl } from '../voice/bethesdaTools/url';
import { resolveTtsBaseUrl } from '../voice/voiceToolPaths';
import type { VllmServerEntry } from '../llm/vllmServerConfig';
import { normalizeServiceEndpoints, type ServiceEndpoint, type ServiceKind } from './kinds';

/** audio-intel's own `MAX_CONCURRENT_REQUESTS` default. */
const AUDIO_INTEL_DEFAULT_PARALLEL = 2;

const envInt = (name: string, fallback: number): number => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const entry = (
  kind: ServiceKind,
  host: string,
  maxParallel: number,
  apiKey = '',
): ServiceEndpoint => ({
  kind,
  host: host.replace(/\/+$/, ''),
  maxParallel: Math.max(1, Math.min(32, maxParallel)),
  apiKey,
  managed: false,
});

/** Endpoints the environment alone describes (the bootstrap before any setting). */
const envServiceEndpoints = (overrides: { ttsMaxParallel?: number } = {}): ServiceEndpoint[] => {
  const out: ServiceEndpoint[] = [];
  for (const server of CONFIG.vllmServers) {
    out.push(entry('llm', server.host, server.maxParallel, server.apiKey));
  }
  out.push(entry('embed', CONFIG.vllmEmbedBaseUrl, CONFIG.embedMaxParallel, CONFIG.vllmApiKey));
  out.push(entry('tts', resolveTtsBaseUrl(), overrides.ttsMaxParallel ?? 1));
  const asrParallel = envInt('AUDIO_INTEL_MAX_PARALLEL', AUDIO_INTEL_DEFAULT_PARALLEL);
  out.push(entry('asr', resolveAudioIntelBaseUrl(), asrParallel));
  const tools = resolveBethesdaToolsUrl();
  if (tools) out.push(entry('tools', tools, envInt('BETHESDA_TOOLS_WINE_SERVERS', 1)));
  return out;
};

export type ServiceRegistrySources = {
  /** Project setting `services.endpoints`. */
  configured: readonly ServiceEndpoint[];
  /** Project setting `llm.vllm_servers` (older, still honoured for `llm`). */
  legacyLlm: readonly VllmServerEntry[];
  /** Env bootstrap; the TTS row's limit comes from `voice.tts_max_parallel_fish_speech`. */
  env: readonly ServiceEndpoint[];
};

export class ServiceRegistry {
  private sources: ServiceRegistrySources;
  private listeners: Array<(kind: ServiceKind) => void> = [];

  constructor(sources: ServiceRegistrySources) {
    this.sources = sources;
  }

  /** Resolved endpoints of one kind (see the module comment for the order). */
  endpoints(kind: ServiceKind): ServiceEndpoint[] {
    const configured = this.sources.configured.filter((e) => e.kind === kind);
    if (configured.length > 0) return configured;
    if (kind === 'llm' && this.sources.legacyLlm.length > 0) {
      return this.sources.legacyLlm.map((s) => entry('llm', s.host, s.maxParallel, s.apiKey));
    }
    if (kind === 'separate') {
      const own = this.sources.env.filter((e) => e.kind === 'separate');
      if (own.length > 0) return own;
      return this.endpoints('asr').map((e) => ({ ...e, kind: 'separate', maxParallel: 1 }));
    }
    return this.sources.env.filter((e) => e.kind === kind);
  }

  /** Which source currently answers for a kind (for the UI). */
  sourceOf(kind: ServiceKind): 'settings' | 'legacy-llm' | 'env' | 'asr' {
    if (this.sources.configured.some((e) => e.kind === kind)) return 'settings';
    if (kind === 'llm' && this.sources.legacyLlm.length > 0) return 'legacy-llm';
    if (kind === 'separate' && !this.sources.env.some((e) => e.kind === 'separate')) return 'asr';
    return 'env';
  }

  all(): Record<ServiceKind, ServiceEndpoint[]> {
    return {
      llm: this.endpoints('llm'),
      embed: this.endpoints('embed'),
      tts: this.endpoints('tts'),
      asr: this.endpoints('asr'),
      separate: this.endpoints('separate'),
      tools: this.endpoints('tools'),
    };
  }

  /** Replace the sources (project settings changed); listeners rebuild their pools. */
  update(sources: Partial<ServiceRegistrySources>): void {
    const before = this.all();
    this.sources = { ...this.sources, ...sources };
    const after = this.all();
    for (const kind of Object.keys(after) as ServiceKind[]) {
      if (JSON.stringify(before[kind]) !== JSON.stringify(after[kind])) {
        for (const listener of this.listeners) listener(kind);
      }
    }
  }

  onChange(listener: (kind: ServiceKind) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}

/** Process-wide registry; bootstrapped from env, overlaid by project settings at boot. */
export const serviceRegistry = new ServiceRegistry({
  configured: [],
  legacyLlm: [],
  env: envServiceEndpoints(),
});

/**
 * Apply project settings to the registry. Called at boot (server, worker) and whenever
 * `services.endpoints`, `llm.vllm_servers` or `voice.tts_max_parallel_fish_speech` change.
 */
export const syncServiceRegistryFromProjectSettings = (settings: {
  'services.endpoints'?: unknown;
  'llm.vllm_servers'?: readonly VllmServerEntry[];
  'voice.tts_max_parallel_fish_speech'?: number;
}): void => {
  serviceRegistry.update({
    configured: normalizeServiceEndpoints(settings['services.endpoints'] ?? []),
    legacyLlm: settings['llm.vllm_servers'] ?? [],
    env: envServiceEndpoints({ ttsMaxParallel: settings['voice.tts_max_parallel_fish_speech'] }),
  });
};
