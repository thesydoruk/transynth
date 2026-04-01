// Embeddings via LLM provider (Ollama or OpenAI)
import { embedWithFallback } from './index';
import { log } from '../logger';

export const embedMany = async (texts: string[], model: string): Promise<number[][]> => {
  log.debug(`embedMany: ${texts.length} texts, model=${model}`);
  return embedWithFallback(texts, model);
}

export const cosine = (a: number[], b: number[]): number => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
