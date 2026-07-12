/**
 * Create mod_lang_stats (if missing) and backfill cached counts for all mods.
 *
 * Usage:
 *   npm run db:refresh-mod-stats
 *   npm run db:refresh-mod-stats -- --game=fo4 --src=en --tgt=uk
 */
import '../src/loadEnv.js';
import { closeDb, openDb } from '../src/db.js';
import { refreshAllModLangStats } from '../src/web/services/modLangStats.js';

const readArg = (prefix: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit?.slice(prefix.length + 1);
};

const db = openDb();

await db.query(`
  CREATE TABLE IF NOT EXISTS mod_lang_stats (
    mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
    src_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    record_count BIGINT NOT NULL DEFAULT 0,
    string_count BIGINT NOT NULL DEFAULT 0,
    translated_count BIGINT NOT NULL DEFAULT 0,
    approved_count BIGINT NOT NULL DEFAULT 0,
    fuzzy_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (mod_id, src_lang, target_lang)
  );
  CREATE INDEX IF NOT EXISTS idx_mod_lang_stats_langs ON mod_lang_stats(src_lang, target_lang);
`);

const count = await refreshAllModLangStats(db, {
  game: readArg('--game'),
  srcLang: readArg('--src'),
  targetLang: readArg('--tgt'),
});

console.log(`Refreshed mod_lang_stats for ${count} mod(s).`);
await closeDb();
