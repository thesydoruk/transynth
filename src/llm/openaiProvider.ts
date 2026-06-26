/**
 * OpenAI backend — implements {@link LLMProvider} using the official `openai` SDK
 * against the OpenAI REST API.
 *
 * API key is read from `CONFIG.openaiApiKey`.
 */
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions, ChatResult, EmbedOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';

/**
 * LLM provider that delegates all inference to the OpenAI API.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: CONFIG.openaiApiKey,
      timeout: CONFIG.llmRequestTimeoutMs,
    });
  }

  /**
   * Send a chat completion request to the OpenAI API.
   *
   * @param opts - Model, messages, temperature, and optional JSON mode flag.
   * @returns The model's plain-text reply.
   */
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const resp = await withRetry(() =>
      this.client.chat.completions.create(
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

  /**
   * Generate embeddings for an array of texts via the OpenAI embeddings API.
   *
   * @param texts - Strings to embed.
   * @param model - Model name (e.g. `text-embedding-3-small`).
   * @returns One float vector per input text.
   */
  async embed(texts: string[], model: string, options?: EmbedOptions): Promise<number[][]> {
    const resp = await withRetry(() =>
      this.client.embeddings.create({
        model,
        input: texts,
        ...(options?.dimensions && model.includes('embedding-3')
          ? { dimensions: options.dimensions }
          : {}),
      }),
    );
    return resp.data.map((v) => v.embedding);
  }
}
