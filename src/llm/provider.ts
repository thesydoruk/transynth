// Unified LLM provider interface — backends: ollama | openai

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: { type: 'json_object' };
}

export interface LLMProvider {
  readonly name: string;
  chat(opts: ChatOptions): Promise<string>;
  embed(texts: string[], model: string): Promise<number[][]>;
}
