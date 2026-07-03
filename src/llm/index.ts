// LLM provider factory — resolves provider from CONFIG.llmProvider
import type { LLMProvider, ChatOptions, ChatResult, EmbedOptions } from './provider';
import { CONFIG, type LLMProviderName } from '../config';
import { isAbortError, isRetryableLlmError, isLlmTimeoutError } from './retry';
import { embedPool, llmChatPool } from './requestPool';
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

/** Monotonic sequence for per-request temperature decay (see {@link resolveLlmChatTemperature}). */
let llmChatRequestSeq = 0;

/** Temperature for the Nth chat request: `max(0, base - N * decay)`. */
export const resolveLlmChatTemperature = (seq: number): number =>
  Math.max(0, CONFIG.llmTemperature - seq * CONFIG.llmTemperatureDecay);

const nextChatTemperature = (): number => resolveLlmChatTemperature(llmChatRequestSeq++);

/** Reset the chat temperature sequence (tests / long-lived workers). */
export const resetLlmChatTemperatureSeq = (): void => {
  llmChatRequestSeq = 0;
};

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

const llmChatBackoffMs = (attempt: number): number =>
  Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 30_000);

const isAvailabilityError = (err: unknown): boolean => {
  const e = err as HttpLikeError;
  return AVAILABILITY_CODES.has(e?.code ?? '') || e?.status === 503;
};

const chatOperation = (opts: ChatOptions): string => opts.logMeta?.operation ?? 'chat';

/** Chat with automatic fallback to secondary provider on availability errors. */
export const chatWithFallback = async (opts: ChatOptions): Promise<ChatResult> => {
  const usedExplicitTemperature = opts.temperature != null;
  const temperature = usedExplicitTemperature ? opts.temperature! : nextChatTemperature();
  const chatOpts: ChatOptions = { ...opts, temperature };
  const operation = chatOperation(chatOpts);
  const context = {
    ...chatOpts.logMeta?.context,
    temperature,
    ...(usedExplicitTemperature ? {} : { temperatureSeq: llmChatRequestSeq - 1 }),
  };
  logLlmRequest(logLlm, {
    operation,
    model: chatOpts.model,
    messages: chatOpts.messages,
    responseFormat: chatOpts.responseFormat?.type,
    schemaName:
      chatOpts.responseFormat?.type === 'json_schema'
        ? chatOpts.responseFormat.json_schema.name
        : undefined,
    context,
  });

  const started = Date.now();

  const runChat = async (
    provider: LLMProvider,
    attemptContext: Record<string, unknown>,
  ): Promise<ChatResult> => {
    const queueWaitMs = Date.now() - started;
    const httpStarted = Date.now();
    try {
      const result = await provider.chat(chatOpts);
      logLlmResponse(logLlm, {
        operation,
        model: chatOpts.model,
        response: result.content,
        durationMs: Date.now() - httpStarted,
        provider: provider.name,
        finishReason: result.meta.finishReason,
        promptTokens: result.meta.promptTokens,
        completionTokens: result.meta.completionTokens,
        totalTokens: result.meta.totalTokens,
        context: { ...attemptContext, queueWaitMs },
      });
      if (result.meta.finishReason === 'length') {
        logLlm.warn(`${operation} response truncated (finish_reason=length)`, {
          model: chatOpts.model,
          provider: provider.name,
          responseChars: result.content.length,
          completionTokens: result.meta.completionTokens,
          maxTokens: chatOpts.maxTokens ?? CONFIG.llmMaxTokens,
          ...attemptContext,
        });
      }
      return result;
    } catch (err) {
      if (isAbortError(err)) {
        logLlm.debug(`${operation} aborted`, { model: chatOpts.model, provider: provider.name });
        throw err;
      }
      logLlm.error(`${operation} failed`, {
        model: chatOpts.model,
        provider: provider.name,
        durationMs: Date.now() - httpStarted,
        queueWaitMs,
        pool: llmChatPool.stats,
        err: err instanceof Error ? err.message : String(err),
        ...attemptContext,
      });
      throw err;
    }
  };

  const primary = getLLM();
  const fallback = makeFallback();
  const maxAttempts = CONFIG.llmMaxAttempts;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptContext = { ...context, httpAttempt: attempt + 1, maxAttempts };

    const callProvider = async (provider: LLMProvider): Promise<ChatResult> =>
      llmChatPool.run(() => runChat(provider, attemptContext));

    try {
      return await callProvider(primary);
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastErr = err;

      if (fallback && isAvailabilityError(err)) {
        logLlm.warn(`${operation} primary unavailable, using fallback`, {
          primary: primary.name,
          fallback: CONFIG.llmFallback,
          ...attemptContext,
        });
        try {
          return await callProvider(fallback);
        } catch (fallbackErr) {
          if (isAbortError(fallbackErr)) throw fallbackErr;
          lastErr = fallbackErr;
        }
      }

      if (
        !isRetryableLlmError(lastErr) ||
        isLlmTimeoutError(lastErr) ||
        attempt === maxAttempts - 1
      ) {
        throw lastErr;
      }

      const delay = llmChatBackoffMs(attempt);
      logLlm.warn(`${operation} HTTP retry`, {
        delayMs: Math.round(delay),
        err: lastErr instanceof Error ? lastErr.message : String(lastErr),
        pool: llmChatPool.stats,
        ...attemptContext,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
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
    return await embedPool.run(() => runEmbed(primary));
  } catch (err) {
    const fallback = makeFallback();
    if (!fallback || !isAvailabilityError(err)) throw err;
    logEmbed.warn(`${operation} primary unavailable, using fallback`, {
      primary: primary.name,
      fallback: CONFIG.llmFallback,
      ...context,
    });
    return embedPool.run(() => runEmbed(fallback));
  }
};

export {
  embedPool,
  llmChatPool,
  llmRagConcurrency,
  llmChatPipelineConcurrency,
} from './requestPool';
export type { RequestPoolStats } from './requestPool';

export type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ChatCompletionMeta,
  EmbedOptions,
} from './provider';
