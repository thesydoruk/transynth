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
  private chatClient: OpenAI;
  private embedClient: OpenAI;

  constructor() {
    const chatBaseURL = normalizeBaseUrl(CONFIG.vllmBaseUrl);
    const embedBaseURL = normalizeBaseUrl(CONFIG.vllmEmbedBaseUrl);
    const apiKey = CONFIG.vllmApiKey || 'EMPTY';
    this.chatClient = new OpenAI({ baseURL: chatBaseURL, apiKey });
    this.embedClient = new OpenAI({ baseURL: embedBaseURL, apiKey });
    log.debug(`vLLM provider: chat=${chatBaseURL}, embed=${embedBaseURL}`);
  }

  async chat(opts: ChatOptions): Promise<string> {
    log.debug(`vLLM chat: model=${opts.model}, messages=${opts.messages.length}`);
    const resp = await withRetry(() =>
      this.chatClient.chat.completions.create({
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
    const resp = await withRetry(() => this.embedClient.embeddings.create({ model, input: texts }));
    return resp.data.map((v) => v.embedding);
  }
}
