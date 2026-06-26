/**
 * OpenAI-compatible local inference backend (vLLM, TGI, etc.).
 *
 * Connects to `CONFIG.vllmBaseUrl` using the standard `/v1` REST API.
 */
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions, ChatResult, EmbedOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';
import { logLlm } from '../logging/loggers';

const normalizeBaseUrl = (url: string): string => {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
};

/**
 * LLM provider for any OpenAI-compatible inference server (vLLM by default).
 */
export class VllmProvider implements LLMProvider {
  readonly name = 'vllm';
  private chatClient: OpenAI;
  private embedClient: OpenAI;

  constructor() {
    const chatBaseURL = normalizeBaseUrl(CONFIG.vllmBaseUrl);
    const embedBaseURL = normalizeBaseUrl(CONFIG.vllmEmbedBaseUrl);
    const apiKey = CONFIG.vllmApiKey || 'EMPTY';
    const clientOpts = { apiKey, timeout: CONFIG.llmRequestTimeoutMs };
    this.chatClient = new OpenAI({ ...clientOpts, baseURL: chatBaseURL });
    this.embedClient = new OpenAI({ ...clientOpts, baseURL: embedBaseURL });
    logLlm.debug('vLLM provider initialized', {
      chatBaseURL,
      embedBaseURL,
      requestTimeoutSec: CONFIG.llmRequestTimeoutMs / 1000,
    });
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const resp = await withRetry(() =>
      this.chatClient.chat.completions.create(
        {
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0,
          max_tokens: CONFIG.llmMaxTokens,
          ...(opts.responseFormat && { response_format: opts.responseFormat }),
        },
        opts.signal ? { signal: opts.signal } : undefined,
      ),
    );
    const choice = resp.choices[0];
    const usage = resp.usage;
    return {
      content: choice?.message?.content ?? '',
      meta: {
        finishReason: choice?.finish_reason ?? null,
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
        totalTokens: usage?.total_tokens ?? null,
      },
    };
  }

  async embed(texts: string[], model: string, _options?: EmbedOptions): Promise<number[][]> {
    const resp = await withRetry(() => this.embedClient.embeddings.create({ model, input: texts }));
    return resp.data.map((v) => v.embedding);
  }
}
