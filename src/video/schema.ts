import type { Tx } from '../db';

/** Mirrors the `video_*` block of `sql/schema.sql`; keep the two in sync. */
export const ensureVideoSchema = async (db: Tx): Promise<void> => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS video_assets (
      id SERIAL PRIMARY KEY,
      game TEXT NOT NULL,
      agent_key TEXT,
      file_name TEXT NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL,
      duration_s DOUBLE PRECISION,
      track_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_track_id INTEGER,
      audio_rel_path TEXT,
      status TEXT NOT NULL DEFAULT 'registered',
      mod_id INTEGER REFERENCES mods(id) ON DELETE SET NULL,
      dub_rel_path TEXT,
      dub_version TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (game, file_name)
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS video_segments (
      id SERIAL PRIMARY KEY,
      video_id INTEGER NOT NULL REFERENCES video_assets(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      start_s DOUBLE PRECISION NOT NULL,
      end_s DOUBLE PRECISION NOT NULL,
      speaker TEXT,
      source_text TEXT NOT NULL DEFAULT '',
      string_id INTEGER REFERENCES strings(id) ON DELETE SET NULL,
      take_rel_path TEXT,
      take_similarity DOUBLE PRECISION,
      tempo DOUBLE PRECISION,
      overrun BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (video_id, idx)
    )`);
  // What the take was made from (translation + slot), so a dub re-run synthesizes only what changed.
  await db.query(`ALTER TABLE video_segments ADD COLUMN IF NOT EXISTS take_version TEXT`);
};
