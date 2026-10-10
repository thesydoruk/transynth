/**
 * Jest setup file for the database suite. Runs before any test module loads,
 * so `CONFIG` reads these values.
 */
// @ts-expect-error -- plain .mjs shared with the global setup, no type declarations.
import { resolveTestDatabaseUrl } from './testDbUrl.mjs';

process.env.DATABASE_URL = (resolveTestDatabaseUrl() as { url: string }).url;
// Nothing in this suite may reach a model server; a closed port fails at once.
process.env.VLLM_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.VLLM_EMBED_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_API_KEY = '';
// The suite logs nothing worth reading; failures speak through assertions.
process.env.LOG_LEVEL ??= 'warn';
