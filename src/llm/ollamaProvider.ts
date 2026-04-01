/**
 * Ollama backend — implements {@link LLMProvider} via the OpenAI-compatible `/v1` API
 * exposed by a local or remote Ollama server.
 *
 * Connection is configured by `CONFIG.ollamaBaseUrl`.
 */
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';
import { log } from '../logger';

/**
 * LLM provider that delegates all inference to an Ollama instance.
 *
 * Uses the `openai` SDK pointed at `ollamaBaseUrl/v1` so that model selection
 * and prompt format remain identical to the OpenAI provider.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: `${CONFIG.ollamaBaseUrl}/v1`,
      apiKey: 'ollama', // Ollama doesn't require a real key
    });
    log.debug(`Ollama provider: baseURL=${CONFIG.ollamaBaseUrl}/v1`);
  }

  /**
   * Send a chat completion request to the local Ollama server.
   *
   * @param opts - Model, messages, temperature, and optional JSON mode flag.
   * @returns The model's plain-text reply.
   */
  async chat(opts: ChatOptions): Promise<string> {
    log.debug(`Ollama chat: model=${opts.model}, messages=${opts.messages.length}`);
    const resp = await withRetry(() => this.client.chat.completions.create({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0,
      ...(opts.responseFormat && { response_format: opts.responseFormat }),
    }));
    return resp.choices[0]?.message?.content ?? '';
  }

  /**
   * Generate embeddings for an array of texts via Ollama's embedding endpoint.
   *
   * @param texts - Strings to embed.
   * @param model - Model name (e.g. `nomic-embed-text`).
   * @returns One float vector per input text.
   */
  async embed(texts: string[], model: string): Promise<number[][]> {
    log.debug(`Ollama embed: model=${model}, texts=${texts.length}`);
    const resp = await withRetry(() => this.client.embeddings.create({ model, input: texts }));
    return resp.data.map(v => v.embedding);
  }
}
