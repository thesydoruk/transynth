/**
 * OpenAI backend — implements {@link LLMProvider} using the official `openai` SDK
 * against the OpenAI REST API.
 *
 * API key is read from `CONFIG.openaiApiKey`.
 */
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions, EmbedOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';

/**
 * LLM provider that delegates all inference to the OpenAI API.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: CONFIG.openaiApiKey });
  }

  /**
   * Send a chat completion request to the OpenAI API.
   *
   * @param opts - Model, messages, temperature, and optional JSON mode flag.
   * @returns The model's plain-text reply.
   */
  async chat(opts: ChatOptions): Promise<string> {
    const resp = await withRetry(() =>
      this.client.chat.completions.create(
        {
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature ?? 0,
          ...(opts.responseFormat && { response_format: opts.responseFormat }),
        },
        opts.signal ? { signal: opts.signal } : undefined,
      ),
    );
    return resp.choices[0]?.message?.content ?? '';
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
