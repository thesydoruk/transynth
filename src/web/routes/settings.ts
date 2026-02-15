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
    };
  });
};
