import 'dotenv/config';

export const CONFIG = {
  dbPath: process.env.DATABASE_PATH || './localizer.sqlite',
  translateModel: process.env.OPENAI_TRANSLATE_MODEL || 'gpt-5.1-mini',
  embedModel: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-large',
};
