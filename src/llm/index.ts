// LLM provider factory — resolves provider from CONFIG.llmProvider
import type { LLMProvider, ChatOptions } from './provider.js';
import { CONFIG } from '../config.js';
import { OllamaProvider } from './ollamaProvider.js';
import { OpenAIProvider } from './openaiProvider.js';
import { log } from '../logger.js';

let _instance: LLMProvider | undefined;

export const getLLM = (): LLMProvider => {
  if (_instance) return _instance;
  _instance = CONFIG.llmProvider === 'openai'
    ? new OpenAIProvider()
    : new OllamaProvider();
  log.info(`LLM provider: ${_instance.name}`);
  return _instance;
}

const makeFallback = (): LLMProvider | null => {
  if (CONFIG.llmFallback === 'none') return null;
  return CONFIG.llmFallback === 'openai' ? new OpenAIProvider() : new OllamaProvider();
}

const AVAILABILITY_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

const isAvailabilityError = (err: any): boolean => {
  return AVAILABILITY_CODES.has(err?.code) || err?.status === 503;
}

/** Chat with automatic fallback to secondary provider on availability errors. */
export const chatWithFallback = async (opts: ChatOptions): Promise<string> => {
  const primary = getLLM();
  try {
    return await primary.chat(opts);
  } catch (err: any) {
    const fallback = makeFallback();
    if (!fallback || !isAvailabilityError(err)) throw err;
    log.warn(`Primary LLM (${primary.name}) unavailable, falling back to ${CONFIG.llmFallback}`);
    return fallback.chat(opts);
  }
}

/** Embed with automatic fallback to secondary provider on availability errors. */
export const embedWithFallback = async (texts: string[], model: string): Promise<number[][]> => {
  const primary = getLLM();
  try {
    return await primary.embed(texts, model);
  } catch (err: any) {
    const fallback = makeFallback();
    if (!fallback || !isAvailabilityError(err)) throw err;
    log.warn(`Primary LLM (${primary.name}) unavailable for embeddings, falling back to ${CONFIG.llmFallback}`);
    return fallback.embed(texts, model);
  }
}

export type { LLMProvider, ChatMessage, ChatOptions } from './provider.js';
