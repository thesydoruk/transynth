// OpenAI backend
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions } from './provider.js';
import { CONFIG } from '../config.js';
import { withRetry } from './retry.js';
import { log } from '../logger.js';

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: CONFIG.openaiApiKey });
    log.debug('OpenAI provider initialised');
  }

  async chat(opts: ChatOptions): Promise<string> {
    log.debug(`OpenAI chat: model=${opts.model}, messages=${opts.messages.length}`);
    const resp = await withRetry(() => this.client.chat.completions.create({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0,
      ...(opts.responseFormat && { response_format: opts.responseFormat }),
    }));
    return resp.choices[0]?.message?.content ?? '';
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    log.debug(`OpenAI embed: model=${model}, texts=${texts.length}`);
    const resp = await withRetry(() => this.client.embeddings.create({ model, input: texts }));
    return resp.data.map(v => v.embedding);
  }
}
