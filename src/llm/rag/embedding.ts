import { getEmbedModel } from '../../config';
import { embedMany } from '../embed';
import { logRag } from '../../logging/loggers';
import { RAG_EMBED_DIMENSIONS } from '../ragConstants';

/** Build the text that is embedded for indexing and retrieval. */
export const buildEmbeddingInput = (opts: {
  sourceText: string;
  signature?: string | null;
  path?: string | null;
  context?: string | null;
}): string => {
  const parts: string[] = [];
  if (opts.signature) parts.push(`signature: ${opts.signature}`);
  if (opts.path) parts.push(`path: ${opts.path}`);
  if (opts.context) parts.push(`context: ${opts.context}`);
  parts.push(`source: ${opts.sourceText}`);
  return parts.join(' | ');
};

const normalizeEmbedding = (vec: number[]): number[] => {
  if (vec.length === RAG_EMBED_DIMENSIONS) return vec;
  if (vec.length > RAG_EMBED_DIMENSIONS) return vec.slice(0, RAG_EMBED_DIMENSIONS);
  return [...vec, ...new Array(RAG_EMBED_DIMENSIONS - vec.length).fill(0)];
};

export const vectorLiteral = (vec: number[]): string => `[${vec.join(',')}]`;

export const embedTextsForRag = async (texts: string[]): Promise<number[][]> => {
  const model = getEmbedModel();
  const vectors = await embedMany(texts, model, {
    dimensions: RAG_EMBED_DIMENSIONS,
    logMeta: {
      operation: 'rag_embed',
      context: { textCount: texts.length },
    },
  });
  return vectors.map(normalizeEmbedding);
};

const isEmbedPayloadTooLarge = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b413\b/.test(msg) || msg.toLowerCase().includes('payload too large');
};

/** Split embed batches on HTTP 413 until the server accepts the payload. */
export const embedTextsForRagResilient = async (texts: string[]): Promise<number[][]> => {
  if (texts.length === 0) return [];
  try {
    return await embedTextsForRag(texts);
  } catch (err) {
    if (!isEmbedPayloadTooLarge(err) || texts.length <= 1) throw err;
    const mid = Math.ceil(texts.length / 2);
    logRag.debug('rag_embed split after 413', {
      from: texts.length,
      left: mid,
      right: texts.length - mid,
    });
    const left = await embedTextsForRagResilient(texts.slice(0, mid));
    const right = await embedTextsForRagResilient(texts.slice(mid));
    return [...left, ...right];
  }
};
