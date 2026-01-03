// Ollama backend — uses OpenAI-compatible API at /v1
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions } from './provider.js';
import { CONFIG } from '../config.js';
import { withRetry } from './retry.js';

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      baseURL: `${CONFIG.ollamaBaseUrl}/v1`,
      apiKey: 'ollama', // Ollama doesn't require a real key
    });
  }

  async chat(opts: ChatOptions): Promise<string> {
    const resp = await withRetry(() => this.client.chat.completions.create({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0,
      ...(opts.responseFormat && { response_format: opts.responseFormat }),
    }));
    return resp.choices[0]?.message?.content ?? '';
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const resp = await withRetry(() => this.client.embeddings.create({ model, input: texts }));
    return resp.data.map(v => v.embedding);
  }
}
