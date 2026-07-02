import './loadEnv';
import { resolveDatabaseUrl } from './databaseUrl';
import { log } from './logger';
import { resolveChampollionPath } from './champollionPath';

export type LLMProviderName = 'vllm' | 'openai';

/** Default multipart upload file size limit (1 GiB) when env is not set/invalid. */
const DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024;

const parseUploadMaxFileSizeBytes = (mbValue: string | undefined): number => {
  const parsedMb = Number.parseInt(mbValue ?? '', 10);
  if (Number.isFinite(parsedMb) && parsedMb > 0) return parsedMb * 1024 * 1024;
  return DEFAULT_UPLOAD_MAX_FILE_SIZE_BYTES;
};

const parseMaxParallel = (value: string | undefined, defaultValue: number, max = 32): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
};

const parseLlmMaxTokens = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 256) return 16_384;
  return Math.min(parsed, 131_072);
};

/** Per HTTP request timeout for OpenAI SDK (default 600 s = 10 min, same as the SDK). */
const parseLlmRequestTimeoutMs = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 600_000;
  return Math.min(parsed, 3_600) * 1000;
};

const parsePositiveInt = (value: string | undefined, defaultValue: number, max: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
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

  /** Flush LLM batch when combined source text exceeds this (avoids output truncation). */
  llmBatchMaxSourceChars: parsePositiveInt(process.env.LLM_BATCH_MAX_SOURCE_CHARS, 12_000, 100_000),

  /** Solo LLM request when a single source row exceeds this length (default 500). */
  llmBatchMaxSingleSourceChars: parsePositiveInt(
    process.env.LLM_BATCH_MAX_SINGLE_SOURCE_CHARS,
    500,
    100_000,
  ),

  /** Max retry attempts for transient LLM HTTP errors and parse failures (default 5). */
  llmMaxAttempts: (() => {
    const parsed = Number.parseInt(process.env.LLM_MAX_ATTEMPTS ?? '', 10);
    return Number.isFinite(parsed) && parsed >= 1 ? Math.min(parsed, 10) : 5;
  })(),

  /** Max tokens in each chat completion response (default 16384). */
  llmMaxTokens: parseLlmMaxTokens(process.env.LLM_MAX_TOKENS),

  /** OpenAI SDK HTTP timeout per request in ms (env: LLM_REQUEST_TIMEOUT_SEC). */
  llmRequestTimeoutMs: parseLlmRequestTimeoutMs(process.env.LLM_REQUEST_TIMEOUT_SEC),

  /** Per verify LLM call deadline in ms — abort and retry before the SDK timeout (env: LLM_VERIFY_TIMEOUT_SEC). */
  llmVerifyRequestTimeoutMs: (() => {
    const sdkMs = parseLlmRequestTimeoutMs(process.env.LLM_REQUEST_TIMEOUT_SEC);
    const parsed = Number.parseInt(process.env.LLM_VERIFY_TIMEOUT_SEC ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.min(parsed * 1000, sdkMs);
    }
    return Math.min(45_000, sdkMs);
  })(),

  /** Max concurrent chat/translate LLM HTTP requests (global semaphore). */
  llmMaxParallel: parseMaxParallel(process.env.LLM_MAX_PARALLEL, 2),
  /** Max concurrent embedding HTTP requests (global semaphore). */
  embedMaxParallel: parseMaxParallel(process.env.EMBED_MAX_PARALLEL, 4),

  /** Texts per RAG embed HTTP request (server may 413 if too large). */
  ragEmbedBatchSize: parsePositiveInt(process.env.RAG_EMBED_BATCH_SIZE, 8, 64),

  /** Source string rows loaded from DB per translate:auto / web job page (default 100). */
  llmTranslateDbChunkSize: parsePositiveInt(process.env.LLM_TRANSLATE_DB_CHUNK_SIZE, 100, 10_000),

  /** Untranslated strings processed per TM auto-apply transaction (default 2000). */
  tmApplyChunkSize: parsePositiveInt(process.env.TM_APPLY_CHUNK_SIZE, 2000, 50_000),

  /** Parallel workers per TM auto-apply chunk (default 1; each worker runs its own DB transaction). */
  tmApplyWorkers: parseMaxParallel(process.env.TM_APPLY_WORKERS, 1, 16),

  /** Records + strings written per mod-import DB transaction (default 5000). */
  modImportBatchSize: parsePositiveInt(process.env.MOD_IMPORT_BATCH_SIZE, 5000, 20_000),

  /** Log/SSE progress every N imported rows during mod import (default 10000). */
  modImportProgressEvery: parsePositiveInt(process.env.MOD_IMPORT_PROGRESS_EVERY, 10_000, 100_000),

  /** Parallel BA2/PEX/MCM file reads during mod import (default 4). */
  modImportIoParallel: parseMaxParallel(process.env.MOD_IMPORT_IO_PARALLEL, 4, 16),

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

  /** Absolute path to Champollion.exe for on-demand PEX decompilation in the editor. */
  champollionPath: resolveChampollionPath(),
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
    `Config: provider=${CONFIG.llmProvider}, fallback=${CONFIG.llmFallback}, batchSize=${CONFIG.batchSize}, llmMaxParallel=${CONFIG.llmMaxParallel}, embedMaxParallel=${CONFIG.embedMaxParallel}, llmMaxTokens=${CONFIG.llmMaxTokens}, llmRequestTimeoutSec=${CONFIG.llmRequestTimeoutMs / 1000}`,
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
