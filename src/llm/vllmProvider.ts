/**
 * OpenAI-compatible local inference backend (vLLM, TGI, etc.).
 *
 * Connects to `CONFIG.vllmBaseUrl` using the standard `/v1` REST API.
 */
import OpenAI from 'openai';
import type { LLMProvider, ChatOptions, EmbedOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';
import { log } from '../logger';

const normalizeBaseUrl = (url: string): string => {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
};

/**
 * LLM provider for any OpenAI-compatible inference server (vLLM by default).
 */
export class VllmProvider implements LLMProvider {
  readonly name = 'vllm';
  private client: OpenAI;

  constructor() {
    const baseURL = normalizeBaseUrl(CONFIG.vllmBaseUrl);
    this.client = new OpenAI({
      baseURL,
      apiKey: CONFIG.vllmApiKey || 'EMPTY',
    });
    log.debug(`vLLM provider: baseURL=${baseURL}`);
  }

  async chat(opts: ChatOptions): Promise<string> {
    log.debug(`vLLM chat: model=${opts.model}, messages=${opts.messages.length}`);
    const resp = await withRetry(() =>
      this.client.chat.completions.create({
        model: opts.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0,
        ...(opts.responseFormat && { response_format: opts.responseFormat }),
      }),
    );
    return resp.choices[0]?.message?.content ?? '';
  }

  async embed(texts: string[], model: string, _options?: EmbedOptions): Promise<number[][]> {
    log.debug(`vLLM embed: model=${model}, texts=${texts.length}`);
    const resp = await withRetry(() => this.client.embeddings.create({ model, input: texts }));
    return resp.data.map((v) => v.embedding);
  }
}
