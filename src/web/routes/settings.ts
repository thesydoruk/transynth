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
import { CONFIG } from '../../config.js';

/* ── Response type ──────────────────────────────────────────────────────── */

/**
 * Public settings payload returned by `GET /api/settings`.
 *
 * All fields are safe to expose — no secrets are included.
 */
export interface SettingsPayload {
  /** Active LLM provider: 'ollama' | 'openai'. */
  llmProvider: string;
  /** Fallback LLM provider when the primary fails: 'ollama' | 'openai' | 'none'. */
  llmFallback: string;
  /** Ollama base URL (included for display; no secret data). */
  ollamaBaseUrl: string;
  /** Ollama model used for translation/embedding. */
  ollamaModel: string;
  /** OpenAI model name used for translation (empty string when not using OpenAI). */
  translateModel: string;
  /** OpenAI model name used for embeddings (empty string when not using OpenAI). */
  embedModel: string;
  /** Whether the OpenAI API key is configured (true/false — key itself never sent). */
  openaiKeyConfigured: boolean;
  /** Translation batch size for LLM auto-translate jobs. */
  batchSize: number;
  /** Whether multi-user authentication mode is active. */
  multiUser: boolean;
  /** Session lifetime in hours (relevant when multiUser = true). */
  sessionLifetimeHours: number;
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

/**
 * Returns true when the selected provider has enough configuration to be used.
 *
 * This helper intentionally validates only static configuration prerequisites.
 * It does not perform network checks (for example, probing Ollama availability)
 * because the settings endpoint must remain fast and side-effect free.
 */
const isProviderConfigured = (provider: string): boolean => {
  if (provider === 'openai') return Boolean(CONFIG.openaiApiKey);
  if (provider === 'ollama') return Boolean(CONFIG.ollamaModel);
  return false;
}

/**
 * Builds a deterministic readiness snapshot for LLM configuration.
 *
 * The result is consumed by the Settings UI to show whether translation is
 * currently possible and which config pieces are missing.
 */
const buildLlmReadiness = (): SettingsPayload['llmReadiness'] => {
  const issues: string[] = [];

  const primaryProvider = isProviderConfigured(CONFIG.llmProvider);
  if (!primaryProvider) {
    if (CONFIG.llmProvider === 'openai') issues.push('primary_openai_key_missing');
    if (CONFIG.llmProvider === 'ollama') issues.push('primary_ollama_model_missing');
  }

  const fallbackProvider = CONFIG.llmFallback === 'none' || isProviderConfigured(CONFIG.llmFallback);
  if (CONFIG.llmFallback !== 'none' && !fallbackProvider) {
    if (CONFIG.llmFallback === 'openai') issues.push('fallback_openai_key_missing');
    if (CONFIG.llmFallback === 'ollama') issues.push('fallback_ollama_model_missing');
  }

  if (CONFIG.llmFallback !== 'none' && CONFIG.llmFallback === CONFIG.llmProvider) {
    issues.push('fallback_same_as_primary');
  }

  const translateModel = CONFIG.llmProvider === 'openai'
    ? Boolean(CONFIG.translateModel)
    : Boolean(CONFIG.ollamaModel);
  if (!translateModel) {
    issues.push(CONFIG.llmProvider === 'openai'
      ? 'translate_model_missing_openai'
      : 'translate_model_missing_ollama');
  }

  const embedModel = CONFIG.llmProvider === 'openai'
    ? Boolean(CONFIG.embedModel)
    : Boolean(CONFIG.ollamaModel);
  if (!embedModel) {
    issues.push(CONFIG.llmProvider === 'openai'
      ? 'embed_model_missing_openai'
      : 'embed_model_missing_ollama');
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
}

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
      ollamaBaseUrl: CONFIG.ollamaBaseUrl,
      ollamaModel: CONFIG.ollamaModel,
      translateModel: CONFIG.translateModel,
      embedModel: CONFIG.embedModel,
      // Never expose the actual key — only whether it's set
      openaiKeyConfigured: Boolean(CONFIG.openaiApiKey),
      batchSize: CONFIG.batchSize,
      multiUser: CONFIG.multiUser,
      sessionLifetimeHours: CONFIG.sessionLifetimeHours,
      llmReadiness: buildLlmReadiness(),
    };
  });
};
