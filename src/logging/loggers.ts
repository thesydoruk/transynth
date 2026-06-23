/**
 * Named loggers for major subsystems.
 *
 * Each logger writes to the main daily log and to `logs/<subsystem>/YYYY-MM-DD.log`.
 */
import { createLogger } from '../logger';

/** Root / miscellaneous application logs. */
export const logApp = createLogger('app');

/** LLM provider, chat/embed API calls, prompts and responses. */
export const logLlm = createLogger('llm');

/** Translation RAG index and retrieval. */
export const logRag = createLogger('rag');

/** Batch LLM translation pipeline (cache, RAG, upsert). */
export const logTranslate = createLogger('translate');

/** LLM translation quality verification jobs. */
export const logVerify = createLogger('verify');

/** LLM mod locale detection. */
export const logLocale = createLogger('locale');

/** Mod import and conversion jobs. */
export const logImport = createLogger('import');

/** LLM translation cache hits/misses. */
export const logCache = createLogger('cache');

/** Embedding helpers (RAG, alignment). */
export const logEmbed = createLogger('embed');

/** HTTP API routes (optional use). */
export const logApi = createLogger('api');
