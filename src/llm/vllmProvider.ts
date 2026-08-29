/**
 * OpenAI-compatible local inference backend (vLLM, TGI, etc.).
 *
 * Connects to `CONFIG.vllmServers` using the standard `/v1` REST API.
 */
import type { LLMProvider, ChatOptions, ChatResult, EmbedOptions } from './provider';
import { CONFIG } from '../config';
import { withRetry } from './retry';
import { logLlm } from '../logging/loggers';
import { createVllmOpenAiClient, normalizeVllmBaseUrl, vllmChatCompletion } from './vllmClient';

/**
 * LLM provider for any OpenAI-compatible inference server (vLLM by default).
 */
export class VllmProvider implements LLMProvider {
  readonly name = 'vllm';
  private embedClient: ReturnType<typeof createVllmOpenAiClient>;

  constructor() {
    const embedBaseURL = normalizeVllmBaseUrl(CONFIG.vllmEmbedBaseUrl);
    this.embedClient = createVllmOpenAiClient(CONFIG.vllmEmbedBaseUrl, CONFIG.vllmApiKey);
    logLlm.debug('vLLM provider initialized', {
      chatServers: CONFIG.vllmServers.length,
      chatMaxParallel: CONFIG.llmMaxParallel,
      embedBaseURL,
      requestTimeoutSec: CONFIG.llmRequestTimeoutMs / 1000,
    });
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const client =
      opts._vllmHttpClient ?? createVllmOpenAiClient(CONFIG.vllmBaseUrl, CONFIG.vllmApiKey);
    return vllmChatCompletion(client, opts);
  }

  async embed(texts: string[], model: string, _options?: EmbedOptions): Promise<number[][]> {
    const resp = await withRetry(() => this.embedClient.embeddings.create({ model, input: texts }));
    return resp.data.map((v) => v.embedding);
  }
}
