/**
 * Public embedding helpers.
 *
 * Wraps {@link embedWithFallback} to provide a stable API used by the alignment
 * pipeline and the translation memory. Automatically falls back to the secondary
 * LLM provider when the primary is unavailable.
 */
import { embedWithFallback, type EmbedCallOptions } from './index';

/**
 * Embed an array of texts using the active LLM provider.
 *
 * @param texts - Strings to embed.
 * @param model - Model name passed to the provider (e.g. `nomic-embed-text`).
 * @param options - Optional dimensions and structured log metadata.
 * @returns A 2-D array of floating-point vectors, one per input text.
 */
export const embedMany = async (
  texts: string[],
  model: string,
  options?: EmbedCallOptions,
): Promise<number[][]> => {
  return embedWithFallback(texts, model, {
    ...options,
    logMeta: options?.logMeta ?? { operation: 'embed_many', context: { textCount: texts.length } },
  });
};

/**
 * Compute the cosine similarity between two embedding vectors.
 *
 * Returns a value in `[-1, 1]`; returns `0` when either vector is all-zero.
 */
export const cosine = (a: number[], b: number[]): number => {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
