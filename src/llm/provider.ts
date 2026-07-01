/**
 * Unified LLM provider interface.
 *
 * Defines the shared contract implemented by {@link VllmProvider} and
 * {@link OpenAIProvider}. Consumers target this interface so that the concrete
 * backend can be swapped at runtime via `CONFIG.llmProvider`.
 */

/**
 * A single message in a chat conversation.
 *
 * @field role    - Speaker: `system` (instructions), `user` (input), `assistant` (model output).
 * @field content - Plain-text message body.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

import type { LlmResponseFormat } from './responseSchemas';

/**
 * Options passed to {@link LLMProvider.chat}.
 *
 * @field model          - Model identifier as known to the backend.
 * @field messages       - Ordered conversation turns.
 * @field temperature    - Sampling temperature (default `0` for deterministic output).
 * @field responseFormat - `json_schema` (guided) or `json_object` (free-form JSON object).
 * @field logMeta        - Optional label for structured debug logs (operation name, context).
 */
export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: LlmResponseFormat;
  /** Aborts the in-flight HTTP request (e.g. when a translate/verify job is stopped). */
  signal?: AbortSignal;
  /** Override completion token budget (defaults to {@link CONFIG.llmMaxTokens}). */
  maxTokens?: number;
  logMeta?: {
    operation: string;
    context?: Record<string, unknown>;
  };
}

export interface EmbedOptions {
  /** Matryoshka dimensions for embedding models that support truncation (e.g. 1024). */
  dimensions?: number;
}

/** Token usage and stop reason from a chat completion API response. */
export interface ChatCompletionMeta {
  finishReason: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

/** Plain-text model reply plus API metadata for diagnostics. */
export interface ChatResult {
  content: string;
  meta: ChatCompletionMeta;
}

/**
 * Minimal interface every LLM backend must satisfy.
 *
 * @field name  - Human-readable backend identifier used in logs and fallback messages.
 */
export interface LLMProvider {
  readonly name: string;
  /** Send a chat prompt and return the model's reply and completion metadata. */
  chat(opts: ChatOptions): Promise<ChatResult>;
  /** Embed an array of texts and return one vector per input. */
  embed(texts: string[], model: string, options?: EmbedOptions): Promise<number[][]>;
}
