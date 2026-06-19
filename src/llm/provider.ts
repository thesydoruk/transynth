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

/**
 * Options passed to {@link LLMProvider.chat}.
 *
 * @field model          - Model identifier as known to the backend.
 * @field messages       - Ordered conversation turns.
 * @field temperature    - Sampling temperature (default `0` for deterministic output).
 * @field responseFormat - When `{ type: 'json_object' }`, instructs the model to return valid JSON.
 */
export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
}

export interface EmbedOptions {
  /** Matryoshka dimensions for embedding models that support truncation (e.g. 1024). */
  dimensions?: number;
}

/**
 * Minimal interface every LLM backend must satisfy.
 *
 * @field name  - Human-readable backend identifier used in logs and fallback messages.
 */
export interface LLMProvider {
  readonly name: string;
  /** Send a chat prompt and return the model’s plain-text reply. */
  chat(opts: ChatOptions): Promise<string>;
  /** Embed an array of texts and return one vector per input. */
  embed(texts: string[], model: string, options?: EmbedOptions): Promise<number[][]>;
}
