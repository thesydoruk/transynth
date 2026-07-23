import type { Tx } from '../../../db';

let columnsReady: Promise<void> | null = null;

/** Idempotent migration for detail-status columns used by the editor status bar. */
export const ensureModLangStatsColumns = async (db: Tx): Promise<void> => {
  if (!columnsReady) {
    columnsReady = db
      .query(
        `
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS draft_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS rejected_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS tm_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS auto_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS skipped_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS untranslated_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS reviewed_count BIGINT NOT NULL DEFAULT 0;
        ALTER TABLE mod_lang_stats ADD COLUMN IF NOT EXISTS human_count BIGINT NOT NULL DEFAULT 0;
        CREATE TABLE IF NOT EXISTS mod_sig_status_stats (
          mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
          src_lang TEXT NOT NULL,
          target_lang TEXT NOT NULL,
          status TEXT NOT NULL,
          signature TEXT NOT NULL,
          count BIGINT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (mod_id, src_lang, target_lang, status, signature)
        );
        CREATE INDEX IF NOT EXISTS idx_mod_sig_status_stats_lookup
          ON mod_sig_status_stats(mod_id, src_lang, target_lang, status);
        `,
      )
      .then(() => undefined)
      .catch((err) => {
        columnsReady = null;
        throw err;
      });
  }
  await columnsReady;
};
