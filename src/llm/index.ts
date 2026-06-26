// LLM provider factory — resolves provider from CONFIG.llmProvider
import type { LLMProvider, ChatOptions, ChatResult, EmbedOptions } from './provider';
import { CONFIG, type LLMProviderName } from '../config';
import { Semaphore } from '../utils/concurrency';
import { isAbortError } from './retry';
import { VllmProvider } from './vllmProvider';
import { OpenAIProvider } from './openaiProvider';
import {
  logLlmRequest,
  logLlmResponse,
  logEmbedRequest,
  logEmbedResponse,
} from '../logging/llmExchange';
import { logLlm, logEmbed } from '../logging/loggers';

let _instance: LLMProvider | undefined;

const llmSemaphore = new Semaphore(CONFIG.llmMaxParallel);
const embedSemaphore = new Semaphore(CONFIG.embedMaxParallel);

/** Network or HTTP-level error shape for availability checks. */
interface HttpLikeError {
  code?: string;
  status?: number;
}

const createProvider = (name: LLMProviderName): LLMProvider => {
  return name === 'openai' ? new OpenAIProvider() : new VllmProvider();
};

export const getLLM = (): LLMProvider => {
  if (_instance) return _instance;
  _instance = createProvider(CONFIG.llmProvider);
  logLlm.info(`provider initialized: ${_instance.name}`);
  return _instance;
};

const makeFallback = (): LLMProvider | null => {
  if (CONFIG.llmFallback === 'none') return null;
  return createProvider(CONFIG.llmFallback);
};

const AVAILABILITY_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

const isAvailabilityError = (err: unknown): boolean => {
  const e = err as HttpLikeError;
  return AVAILABILITY_CODES.has(e?.code ?? '') || e?.status === 503;
};

const chatOperation = (opts: ChatOptions): string => opts.logMeta?.operation ?? 'chat';

/** Chat with automatic fallback to secondary provider on availability errors. */
export const chatWithFallback = async (opts: ChatOptions): Promise<ChatResult> => {
  const operation = chatOperation(opts);
  const context = opts.logMeta?.context;
  logLlmRequest(logLlm, {
    operation,
    model: opts.model,
    messages: opts.messages,
    responseFormat: opts.responseFormat?.type,
    schemaName:
      opts.responseFormat?.type === 'json_schema'
        ? opts.responseFormat.json_schema.name
        : undefined,
    context,
  });

  const started = Date.now();
  const primary = getLLM();

  const runChat = async (provider: LLMProvider): Promise<ChatResult> => {
    try {
      const result = await provider.chat(opts);
      logLlmResponse(logLlm, {
        operation,
        model: opts.model,
        response: result.content,
        durationMs: Date.now() - started,
        provider: provider.name,
        finishReason: result.meta.finishReason,
        promptTokens: result.meta.promptTokens,
        completionTokens: result.meta.completionTokens,
        totalTokens: result.meta.totalTokens,
        context,
      });
      if (result.meta.finishReason === 'length') {
        logLlm.warn(`${operation} response truncated (finish_reason=length)`, {
          model: opts.model,
          provider: provider.name,
          responseChars: result.content.length,
          completionTokens: result.meta.completionTokens,
          maxTokens: CONFIG.llmMaxTokens,
          ...context,
        });
      }
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        logLlm.debug(`${operation} aborted`, { model: opts.model, provider: provider.name });
        throw err;
      }
      logLlm.error(`${operation} failed`, {
        model: opts.model,
        provider: provider.name,
        durationMs: Date.now() - started,
        err: err instanceof Error ? err.message : String(err),
        ...context,
      });
      throw err;
    }
  };

  try {
    return await llmSemaphore.run(() => runChat(primary));
  } catch (err) {
    const fallback = makeFallback();
    if (isAbortError(err) || !fallback || !isAvailabilityError(err)) throw err;
    logLlm.warn(`${operation} primary unavailable, using fallback`, {
      primary: primary.name,
      fallback: CONFIG.llmFallback,
      ...context,
    });
    return llmSemaphore.run(() => runChat(fallback));
  }
};

export type EmbedCallOptions = EmbedOptions & {
  logMeta?: {
    operation: string;
    context?: Record<string, unknown>;
  };
};

/** Embed with automatic fallback to secondary provider on availability errors. */
export const embedWithFallback = async (
  texts: string[],
  model: string,
  options?: EmbedCallOptions,
): Promise<number[][]> => {
  const operation = options?.logMeta?.operation ?? 'embed';
  const context = options?.logMeta?.context;
  logEmbedRequest(logEmbed, {
    operation,
    model,
    textCount: texts.length,
    dimensions: options?.dimensions,
    context,
  });

  const started = Date.now();
  const primary = getLLM();

  const runEmbed = async (provider: LLMProvider): Promise<number[][]> => {
    try {
      const vectors = await provider.embed(texts, model, options);
      logEmbedResponse(logEmbed, {
        operation,
        model,
        vectorCount: vectors.length,
        durationMs: Date.now() - started,
        provider: provider.name,
        context,
      });
      return vectors;
    } catch (err) {
      logEmbed.error(`${operation} failed`, {
        model,
        provider: provider.name,
        durationMs: Date.now() - started,
        textCount: texts.length,
        err: err instanceof Error ? err.message : String(err),
        ...context,
      });
      throw err;
    }
  };

  try {
    return await embedSemaphore.run(() => runEmbed(primary));
  } catch (err) {
    const fallback = makeFallback();
    if (!fallback || !isAvailabilityError(err)) throw err;
    logEmbed.warn(`${operation} primary unavailable, using fallback`, {
      primary: primary.name,
      fallback: CONFIG.llmFallback,
      ...context,
    });
    return embedSemaphore.run(() => runEmbed(fallback));
  }
};

export type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatCompletionMeta,
  EmbedOptions,
} from './provider';
