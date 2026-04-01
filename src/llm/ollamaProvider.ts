// Ollama backend — uses OpenAI-compatible API at /v1
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';
import { log } from '../logger';

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

  async embed(texts: string[], model: string): Promise<number[][]> {
    log.debug(`Ollama embed: model=${model}, texts=${texts.length}`);
    const resp = await withRetry(() => this.client.embeddings.create({ model, input: texts }));
    return resp.data.map(v => v.embedding);
  }
}
