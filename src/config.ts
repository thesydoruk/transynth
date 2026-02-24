import 'dotenv/config';
import { log } from './logger.js';

export type LLMProviderName = 'ollama' | 'openai';

export const CONFIG = {
  llmProvider: (process.env.LLM_PROVIDER || 'ollama') as LLMProviderName,
  llmFallback: (process.env.LLM_FALLBACK || 'none') as LLMProviderName | 'none',

  // Ollama
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || '',

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  translateModel: process.env.OPENAI_TRANSLATE_MODEL || 'gpt-4.1-mini',
  embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-large',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localizer:localizer@localhost:5432/localizer',

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
  if (CONFIG.llmProvider === 'ollama') {
    if (!CONFIG.ollamaModel) throw new Error('OLLAMA_MODEL is required when LLM_PROVIDER=ollama');
    return CONFIG.ollamaModel;
  }
  return CONFIG.translateModel;
}

/** Resolve the embedding model based on provider. */
export const getEmbedModel = (): string => {
  if (CONFIG.llmProvider === 'ollama') {
    if (!CONFIG.ollamaModel) throw new Error('OLLAMA_MODEL is required when LLM_PROVIDER=ollama');
    return CONFIG.ollamaModel;
  }
  return CONFIG.embedModel;
}

/** Fail-fast validation — call at CLI entry points. */
export const validateConfig = (): void => {
  log.info(`Config: provider=${CONFIG.llmProvider}, fallback=${CONFIG.llmFallback}, batchSize=${CONFIG.batchSize}`);
  if (CONFIG.llmProvider === 'openai') {
    if (!CONFIG.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai. Set it in .env or environment.');
    }
  } else if (CONFIG.llmProvider === 'ollama') {
    if (!CONFIG.ollamaModel) {
      throw new Error('OLLAMA_MODEL is required when LLM_PROVIDER=ollama (e.g., llama3, mistral, gemma2).');
    }
  } else {
    throw new Error(`Unknown LLM_PROVIDER="${CONFIG.llmProvider}". Expected "ollama" or "openai".`);
  }
}
