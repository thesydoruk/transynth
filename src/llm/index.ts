// LLM provider factory — resolves provider from CONFIG.llmProvider
import type { LLMProvider } from './provider.js';
import { CONFIG } from '../config.js';
import { OllamaProvider } from './ollamaProvider.js';
import { OpenAIProvider } from './openaiProvider.js';

let _instance: LLMProvider | undefined;

export function getLLM(): LLMProvider {
  if (_instance) return _instance;
  _instance = CONFIG.llmProvider === 'openai'
    ? new OpenAIProvider()
    : new OllamaProvider();
  return _instance;
}

export type { LLMProvider, ChatMessage, ChatOptions } from './provider.js';
