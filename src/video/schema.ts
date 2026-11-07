/**
 * The `video_*` tables, mirrored from `sql/schema.sql`; keep the two in sync.
 *
 * The first shape of `video_assets` was keyed by game, with the phrases in one
 * synthetic `Video` mod per game. A database of that shape is brought over on
 * start: the phrases move into the game's main master under the `VIDEO`
 * scheme (so carry-over finds their translations), the assets are dropped
 * (the next import registers them from the agent's manifests), and the
 * game column goes.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { gamePlugin } from '../games/registry';
import { log } from '../logger';
import { PATHS } from '../paths';
import { videoPhraseEdid, videoPhrasePath, VIDEO_SIGNATURE } from './videoRecords';

const hasColumn = async (db: Tx, table: string, column: string): Promise<boolean> => {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
};

/** The game's main master as a mod: the newest row named after the first official master. */
const mainMasterModId = async (db: Tx, game: string): Promise<number | null> => {
  const master = gamePlugin(game).deployment?.officialMasters?.[0];
  if (!master) return null;
  const stem = path.basename(master, path.extname(master));
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM mods WHERE game = $1 AND lower(name) = lower($2)
      ORDER BY COALESCE(is_current, TRUE) DESC, id DESC LIMIT 1`,
    [game, stem],
  );
  return rows[0]?.id ?? null;
};

const migrateGameScopedAssets = async (db: Tx): Promise<void> => {
  if (!(await hasColumn(db, 'video_assets', 'game'))) return;
  const { rows: assets } = await db.query<{ id: number; game: string; file_name: string }>(
    `SELECT id, game, file_name FROM video_assets ORDER BY id`,
  );
  let moved = 0;
  for (const asset of assets) {
    const owner = await mainMasterModId(db, asset.game);
    if (owner == null) continue;
    const { rows: segments } = await db.query<{ idx: number; string_id: number | null }>(
      `SELECT idx, string_id FROM video_segments WHERE video_id = $1 ORDER BY idx`,
      [asset.id],
    );
    for (const seg of segments) {
      if (seg.string_id == null) continue;
      const { rowCount } = await db.query(
        `UPDATE records r SET mod_id = $2, signature = $3, path = $4, path_simplified = $4,
                formid_hex = '', edid = $5
           FROM strings s
          WHERE s.id = $1 AND r.id = s.record_id
            AND NOT EXISTS (SELECT 1 FROM records x WHERE x.mod_id = $2 AND x.signature = $3
                                                     AND x.path = $4 AND x.formid_hex = '')`,
        [
          seg.string_id,
          owner,
          VIDEO_SIGNATURE,
          videoPhrasePath(asset.file_name, seg.idx),
          videoPhraseEdid(asset.file_name, seg.idx),
        ],
      );
      moved += rowCount ?? 0;
    }
  }
  await db.query(`DELETE FROM video_assets`);
  await db.query(
    `DELETE FROM records WHERE mod_id IN (SELECT id FROM mods WHERE origin = 'video')`,
  );
  await db.query(`DELETE FROM mods WHERE origin = 'video'`);
  for (const game of new Set(assets.map((a) => a.game))) {
    fs.rmSync(path.join(PATHS.videoUploads, game), { recursive: true, force: true });
  }
  await db.query(`ALTER TABLE video_assets DROP COLUMN game`);
  log.info(
    `video_assets: ${assets.length} game-scoped asset(s) dropped, ${moved} phrase record(s) moved into their game's master`,
  );
};

export const ensureVideoSchema = async (db: Tx): Promise<void> => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS video_assets (
      id SERIAL PRIMARY KEY,
      mod_id INTEGER NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
      agent_key TEXT,
      file_name TEXT NOT NULL,
      byte_size BIGINT NOT NULL DEFAULT 0,
      fingerprint TEXT NOT NULL,
      duration_s DOUBLE PRECISION,
      track_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      source_track_id INTEGER,
      audio_rel_path TEXT,
      status TEXT NOT NULL DEFAULT 'registered',
      dub_rel_path TEXT,
      dub_version TEXT,
      packed_version TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (mod_id, file_name)
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
      take_version TEXT,
      tempo DOUBLE PRECISION,
      overrun BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (video_id, idx)
    )`);
  await migrateGameScopedAssets(db);
  // A table created by the first shape: the mod becomes the key and owns the row.
  await db.query(`ALTER TABLE video_assets ALTER COLUMN mod_id SET NOT NULL`);
  await db.query(
    `ALTER TABLE video_assets DROP CONSTRAINT IF EXISTS video_assets_game_file_name_key`,
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS video_assets_mod_id_file_name_key ON video_assets (mod_id, file_name)`,
  );
  await db.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'video_assets_mod_id_fkey' AND confdeltype <> 'c') THEN
        ALTER TABLE video_assets DROP CONSTRAINT video_assets_mod_id_fkey;
        ALTER TABLE video_assets ADD CONSTRAINT video_assets_mod_id_fkey
          FOREIGN KEY (mod_id) REFERENCES mods(id) ON DELETE CASCADE;
      END IF;
    END $$`);
};
