// LLM provider factory — resolves provider from CONFIG.llmProvider
import type { LLMProvider, ChatOptions } from './provider';
import { CONFIG } from '../config';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';
import { log } from '../logger';

let _instance: LLMProvider | undefined;

/** Network or HTTP-level error shape for availability checks. */
interface HttpLikeError {
  code?: string;
  status?: number;
}

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

const isAvailabilityError = (err: unknown): boolean => {
  const e = err as HttpLikeError;
  return AVAILABILITY_CODES.has(e?.code ?? '') || e?.status === 503;
}

/** Chat with automatic fallback to secondary provider on availability errors. */
export const chatWithFallback = async (opts: ChatOptions): Promise<string> => {
  const primary = getLLM();
  try {
    return await primary.chat(opts);
  } catch (err) {
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
  } catch (err) {
    const fallback = makeFallback();
    if (!fallback || !isAvailabilityError(err)) throw err;
    log.warn(`Primary LLM (${primary.name}) unavailable for embeddings, falling back to ${CONFIG.llmFallback}`);
    return fallback.embed(texts, model);
  }
}

export type { LLMProvider, ChatMessage, ChatOptions } from './provider';
