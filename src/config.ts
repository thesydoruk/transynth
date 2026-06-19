import './loadEnv';
import { resolveDatabaseUrl } from './databaseUrl';
import { log } from './logger';

export type LLMProviderName = 'vllm' | 'openai';

/** Default multipart upload file size limit (1 GiB) when env is not set/invalid. */
const DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

const parseUploadMaxFileSizeBytes = (mbValue: string | undefined): number => {
  const parsedMb = Number.parseInt(mbValue ?? '', 10);
  if (Number.isFinite(parsedMb) && parsedMb > 0) return parsedMb * 1024 * 1024;
  return DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES;
};

export const CONFIG = {
  llmProvider: (process.env.LLM_PROVIDER || 'vllm') as LLMProviderName,
  llmFallback: (process.env.LLM_FALLBACK || 'none') as LLMProviderName | 'none',

  // vLLM / OpenAI-compatible local inference
  vllmBaseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000',
  vllmApiKey: process.env.VLLM_API_KEY || '',
  vllmModel: process.env.VLLM_MODEL || '',
  /** Embeddings may run on a separate OpenAI-compatible server (defaults to VLLM_BASE_URL). */
  vllmEmbedBaseUrl:
    process.env.VLLM_EMBED_BASE_URL || process.env.VLLM_BASE_URL || 'http://localhost:8000',
  vllmEmbedModel: process.env.VLLM_EMBED_MODEL || 'Snowflake/snowflake-arctic-embed-l-v2.0',

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  translateModel: process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4.1-mini',
  embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-large',

  // Database
  databaseUrl: resolveDatabaseUrl(),
  /** Max connections in the pg Pool (default 25). */
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '25', 10),
  /** Statement timeout in ms; 0 disables (default 0 — long imports). */
  dbStatementTimeoutMs: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '0', 10),
  /** Idle-in-transaction timeout in ms; 0 disables (default 1 h). */
  dbIdleInTransactionTimeoutMs: parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || '3600000', 10),

  // Maximum multipart upload size in bytes (Fastify multipart fileSize limit).
  uploadMaxFileSizeBytes: parseUploadMaxFileSizeBytes(process.env.UPLOAD_MAX_FILE_SIZE_MB),

  // Translation batch size
  batchSize: parseInt(process.env.BATCH_SIZE || '30', 10),

  // Nexus Mods personal API key (Bearer token).
  // Obtain at: https://www.nexusmods.com/users/myaccount?tab=api
  // Required for NexusMods GraphQL API v2 queries (mod search, translations).
  // The static cover-image CDN does NOT require this key.
  nexusApiKey: process.env.NEXUS_API_KEY || '',

  // Default language pair for translation.
  // SRC_LANG — source language code stored in strings.lang (e.g. 'en').
  // TGT_LANG — target translation language code (e.g. 'uk', 'pl', 'de').
  // These are used as fallback defaults when the caller does not specify a language.
  defaultSrcLang: process.env.SRC_LANG || 'en',
  defaultTgtLang: process.env.TGT_LANG || 'uk',

  // Multi-user mode: when true, authentication is required.
  // When false (default), the app runs as a single-user tool — no login needed.
  multiUser: process.env.MULTI_USER === 'true',

  // Session lifetime in hours (default 72h). Only relevant when MULTI_USER=true.
  sessionLifetimeHours: parseInt(process.env.SESSION_LIFETIME_HOURS || '72', 10),
};

/** Resolve the translation model based on provider. */
export const getTranslateModel = (): string => {
  if (CONFIG.llmProvider === 'vllm') {
    if (!CONFIG.vllmModel) throw new Error('VLLM_MODEL is required when LLM_PROVIDER=vllm');
    return CONFIG.vllmModel;
  }
  return CONFIG.translateModel;
};

/** Resolve the embedding model based on provider. */
export const getEmbedModel = (): string => {
  if (CONFIG.llmProvider === 'vllm') {
    if (!CONFIG.vllmModel && !CONFIG.vllmEmbedModel) {
      throw new Error('VLLM_MODEL or VLLM_EMBED_MODEL is required when LLM_PROVIDER=vllm');
    }
    return CONFIG.vllmEmbedModel || CONFIG.vllmModel;
  }
  return CONFIG.embedModel;
};

/** Fail-fast validation — call at CLI entry points. */
export const validateConfig = (): void => {
  log.info(
    `Config: provider=${CONFIG.llmProvider}, fallback=${CONFIG.llmFallback}, batchSize=${CONFIG.batchSize}`,
  );
  if (CONFIG.llmProvider === 'openai') {
    if (!CONFIG.openaiApiKey) {
      throw new Error(
        'OPENAI_API_KEY is required when LLM_PROVIDER=openai. Set it in .env or environment.',
      );
    }
  } else if (CONFIG.llmProvider === 'vllm') {
    if (!CONFIG.vllmModel) {
      throw new Error('VLLM_MODEL is required when LLM_PROVIDER=vllm.');
    }
  } else {
    throw new Error(`Unknown LLM_PROVIDER="${CONFIG.llmProvider}". Expected "vllm" or "openai".`);
  }
};
