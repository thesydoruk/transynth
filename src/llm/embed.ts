// Embeddings via LLM provider (Ollama or OpenAI)
import { embedWithFallback } from './index.js';

export async function embedMany(texts: string[], model: string): Promise<number[][]> {
  return embedWithFallback(texts, model);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
