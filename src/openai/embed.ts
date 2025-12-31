import { openai } from './client.js';

export async function embedMany(texts: string[], model: string): Promise<number[][]> {
  const resp = await openai.embeddings.create({ model, input: texts });
  return resp.data.map(v => v.embedding as number[]);
}

export function cosine(a: number[], b: number[]) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
