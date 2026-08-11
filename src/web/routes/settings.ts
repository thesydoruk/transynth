/**
 * settings.ts — Project settings API.
 *
 * Exposes a read-only `GET /api/settings` endpoint that returns the active
 * runtime configuration sourced from environment variables (CONFIG).
 *
 * Sensitive values (API keys, database URL) are never returned — only the
 * metadata a UI needs to *display* the current configuration to the user.
 *
 * This endpoint is intentionally read-only: ENV-based settings cannot be
 * changed at runtime without restarting the server. The frontend shows these
 * as informational fields with a note pointing users to the `.env` file.
 */

import type { FastifyInstance } from 'fastify';
import { CONFIG } from '../../config';
import { resolveTtsBaseUrl } from '../../voice/voiceToolPaths';

/* ── Response type ──────────────────────────────────────────────────────── */

/**
 * Public settings payload returned by `GET /api/settings`.
 *
 * All fields are safe to expose — no secrets are included.
 */
export interface SettingsPayload {
  /** Active LLM provider: 'vllm' | 'openai'. */
  llmProvider: string;
  /** Fallback LLM provider when the primary fails: 'vllm' | 'openai' | 'none'. */
  llmFallback: string;
  /** vLLM / OpenAI-compatible server base URL (legacy single-server display). */
  vllmBaseUrl: string;
  /** Configured vLLM chat servers (host + per-server concurrency). */
  vllmServers: Array<{
    host: string;
    maxParallel: number;
    apiKeyConfigured: boolean;
  }>;
  /** True when multi-endpoint chat routing is active (settings or env). */
  vllmMultiServer: boolean;
  /** vLLM model used for translation. */
  vllmModel: string;
  /** vLLM model used for embeddings (falls back to vllmModel when empty). */
  vllmEmbedModel: string;
  /** Whether a vLLM API key is configured. */
  vllmApiKeyConfigured: boolean;
  /** OpenAI model name used for translation. */
  translateModel: string;
  /** OpenAI model name used for embeddings. */
  embedModel: string;
  /** Whether the OpenAI API key is configured (key itself never sent). */
  openaiKeyConfigured: boolean;
  /** Whether the Nexus Mods personal API key is configured. */
  nexusApiKeyConfigured: boolean;
  /** Translation batch size for LLM auto-translate jobs. */
  batchSize: number;
  /** Max concurrent LLM chat/translate HTTP requests. */
  llmMaxParallel: number;
  /** Max concurrent embedding HTTP requests. */
  embedMaxParallel: number;
  /** External TTS server base URL (read-only, from env). */
  ttsBaseUrl: string;
  /** Computed readiness snapshot for the currently configured LLM stack. */
  llmReadiness: {
    /** Overall readiness level used by UI badges. */
    level: 'ok' | 'warn' | 'error';
    /** Whether the current primary provider can process translation requests. */
    canTranslate: boolean;
    /** Per-check booleans for structured UI display. */
    checks: {
      /** Primary provider has the required credentials/model settings. */
      primaryProvider: boolean;
      /** Fallback provider is valid (or intentionally disabled). */
      fallbackProvider: boolean;
      /** Translation model config is present for the active stack. */
      translateModel: boolean;
      /** Embedding model config is present for the active stack. */
      embedModel: boolean;
    };
    /** Machine-readable issue codes (for i18n mapping in UI). */
    issues: string[];
  };
}

const isProviderConfigured = (provider: string): boolean => {
  if (provider === 'openai') return Boolean(CONFIG.openaiApiKey);
  if (provider === 'vllm') return Boolean(CONFIG.vllmModel);
  return false;
};

const buildLlmReadiness = (): SettingsPayload['llmReadiness'] => {
  const issues: string[] = [];

  const primaryProvider = isProviderConfigured(CONFIG.llmProvider);
  if (!primaryProvider) {
    if (CONFIG.llmProvider === 'openai') issues.push('primary_openai_key_missing');
    if (CONFIG.llmProvider === 'vllm') issues.push('primary_vllm_model_missing');
  }

  const fallbackProvider =
    CONFIG.llmFallback === 'none' || isProviderConfigured(CONFIG.llmFallback);
  if (CONFIG.llmFallback !== 'none' && !fallbackProvider) {
    if (CONFIG.llmFallback === 'openai') issues.push('fallback_openai_key_missing');
    if (CONFIG.llmFallback === 'vllm') issues.push('fallback_vllm_model_missing');
  }

  if (CONFIG.llmFallback !== 'none' && CONFIG.llmFallback === CONFIG.llmProvider) {
    issues.push('fallback_same_as_primary');
  }

  const translateModel =
    CONFIG.llmProvider === 'openai' ? Boolean(CONFIG.translateModel) : Boolean(CONFIG.vllmModel);
  if (!translateModel) {
    issues.push(
      CONFIG.llmProvider === 'openai'
        ? 'translate_model_missing_openai'
        : 'translate_model_missing_vllm',
    );
  }

  const embedModel =
    CONFIG.llmProvider === 'openai'
      ? Boolean(CONFIG.embedModel)
      : Boolean(CONFIG.vllmEmbedModel || CONFIG.vllmModel);
  if (!embedModel) {
    issues.push(
      CONFIG.llmProvider === 'openai' ? 'embed_model_missing_openai' : 'embed_model_missing_vllm',
    );
  }

  const canTranslate = primaryProvider && translateModel;
  const level: SettingsPayload['llmReadiness']['level'] = !canTranslate
    ? 'error'
    : issues.length > 0
      ? 'warn'
      : 'ok';

  return {
    level,
    canTranslate,
    checks: {
      primaryProvider,
      fallbackProvider,
      translateModel,
      embedModel,
    },
    issues,
  };
};

/* ── Route registration ─────────────────────────────────────────────────── */

/**
 * Registers the settings route on the Fastify instance.
 *
 * @param app - The Fastify server instance.
 */
export const settingsRoutes = async (app: FastifyInstance): Promise<void> => {
  /**
   * GET /api/settings
   *
   * Returns a snapshot of the current runtime configuration.
   * No database access is needed — all values come from the in-memory CONFIG.
   */
  app.get('/api/settings', async (): Promise<SettingsPayload> => {
    return {
      llmProvider: CONFIG.llmProvider,
      llmFallback: CONFIG.llmFallback,
      vllmBaseUrl: CONFIG.vllmBaseUrl,
      vllmServers: CONFIG.vllmServers.map((s) => ({
        host: s.host,
        maxParallel: s.maxParallel,
        apiKeyConfigured: Boolean(s.apiKey),
      })),
      vllmMultiServer: CONFIG.vllmMultiServer,
      vllmModel: CONFIG.vllmModel,
      vllmEmbedModel: CONFIG.vllmEmbedModel || CONFIG.vllmModel,
      vllmApiKeyConfigured: Boolean(CONFIG.vllmApiKey),
      translateModel: CONFIG.translateModel,
      embedModel: CONFIG.embedModel,
      openaiKeyConfigured: Boolean(CONFIG.openaiApiKey),
      nexusApiKeyConfigured: Boolean(CONFIG.nexusApiKey),
      batchSize: CONFIG.batchSize,
      llmMaxParallel: CONFIG.llmMaxParallel,
      embedMaxParallel: CONFIG.embedMaxParallel,
      ttsBaseUrl: resolveTtsBaseUrl(),
      llmReadiness: buildLlmReadiness(),
    };
  });
};
