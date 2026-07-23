import type { Tx } from '../../db';
import { logRag } from '../../logging/loggers';

let pgvectorCached: boolean | null = null;

/** Whether the pgvector extension is installed (cached after first check). */
export const isPgvectorAvailable = async (db: Tx): Promise<boolean> => {
  if (pgvectorCached !== null) return pgvectorCached;
  try {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok`,
    );
    pgvectorCached = rows[0]?.ok === true;
  } catch {
    pgvectorCached = false;
  }
  return pgvectorCached;
};

/** Throws when pgvector is missing — LLM auto-translation requires RAG vector search. */
export const requirePgvectorForRag = async (db: Tx): Promise<void> => {
  if (!(await isPgvectorAvailable(db))) {
    logRag.error('pgvector extension is not available — LLM translation requires RAG');
    throw new Error(
      'pgvector extension is not available — LLM translation requires RAG with vector search',
    );
  }
  logRag.debug('pgvector available');
};
