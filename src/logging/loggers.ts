/**
 * Named loggers for major subsystems.
 *
 * Each logger writes to the main daily log and to `logs/<subsystem>/YYYY-MM-DD.log`.
 */
import { createLogger } from '../logger';

/** LLM provider, chat/embed API calls, prompts and responses. */
export const logLlm = createLogger('llm');

/** Translation RAG index and retrieval. */
export const logRag = createLogger('rag');

/** Batch LLM translation pipeline (RAG, upsert). */
export const logTranslate = createLogger('translate');

/** LLM translation quality verification jobs. */
export const logVerify = createLogger('verify');

/** Mod import and conversion jobs. */
export const logImport = createLogger('import');

/** Embedding helpers (RAG, alignment). */
export const logEmbed = createLogger('embed');

/** Background job queue and worker lifecycle. */
export const logJobs = createLogger('jobs');
