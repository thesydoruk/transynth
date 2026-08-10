import OpenAI from 'openai';
import type { ChatOptions, ChatResult } from './provider';
import { CONFIG } from '../config';

export const normalizeVllmBaseUrl = (url: string): string => {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
};

export const createVllmOpenAiClient = (host: string, apiKey: string): OpenAI =>
  new OpenAI({
    apiKey: apiKey || 'EMPTY',
    baseURL: normalizeVllmBaseUrl(host),
    timeout: CONFIG.llmRequestTimeoutMs,
    maxRetries: 0,
  });

/** Execute a chat completion on a specific OpenAI-compatible client. */
export const vllmChatCompletion = async (
  client: OpenAI,
  opts: ChatOptions,
): Promise<ChatResult> => {
  const resp = await client.chat.completions.create(
    {
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? CONFIG.llmMaxTokens,
      ...(opts.responseFormat && { response_format: opts.responseFormat }),
      ...(opts.extraBody ?? {}),
    },
    opts.signal ? { signal: opts.signal } : undefined,
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
};
